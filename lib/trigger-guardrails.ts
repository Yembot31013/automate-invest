import type { DeskSettings } from "./desk-settings.ts";
import type { DeskTrigger, TriggerAction } from "@/lib/triggers";

function triggerSymbolsMatch(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replaceAll("/", "") === right.replaceAll("/", "");
}

export type TriggerGuardrailSettings = Pick<
  DeskSettings,
  | "guardrailsEnabled"
  | "maxSymbolExposureUsd"
  | "maxTriggerBuysPerDay"
  | "maxTriggerSpendPerDayUsd"
  | "pauseTriggerBuysWhenBookDownPct"
>;

export type TriggerBuyDayStats = {
  count: number;
  spendUsd: number;
};

export type SymbolExposureContext = {
  symbol: string;
  positionMarketValue: number;
  armedBuyNotional: number;
};

/** Open position value + sum of enabled paper-buy notionals on that symbol. */
export function computeSymbolExposure(
  symbol: string,
  triggers: ReadonlyArray<DeskTrigger>,
  positionMarketValue = 0,
): SymbolExposureContext {
  const sym = symbol.trim().toUpperCase();
  const armedBuyNotional = triggers
    .filter(
      (t) =>
        t.enabled &&
        t.action === "paper_buy" &&
        triggerSymbolsMatch(t.symbol, sym),
    )
    .reduce((sum, t) => sum + t.notionalUsd, 0);
  return {
    symbol: sym,
    positionMarketValue,
    armedBuyNotional,
  };
}

export function totalSymbolExposure(ctx: SymbolExposureContext): number {
  return ctx.positionMarketValue + ctx.armedBuyNotional;
}

function positionMarketValueFor(
  positions: ReadonlyArray<{ symbol: string; marketValue: number }> | undefined,
  symbol: string,
): number {
  if (!positions?.length) return 0;
  return positions
    .filter((p) => triggerSymbolsMatch(p.symbol, symbol))
    .reduce((sum, p) => sum + p.marketValue, 0);
}

/** Create / enable-time guardrail checks for a new or updated buy trigger. */
export function validateTriggerGuardrails(params: {
  settings: TriggerGuardrailSettings;
  symbol: string;
  action: TriggerAction;
  notionalUsd: number;
  triggers: ReadonlyArray<DeskTrigger>;
  positions?: ReadonlyArray<{ symbol: string; marketValue: number }>;
  excludeTriggerId?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!params.settings.guardrailsEnabled || params.action !== "paper_buy") {
    return { ok: true };
  }

  const others = params.excludeTriggerId
    ? params.triggers.filter((t) => t.id !== params.excludeTriggerId)
    : params.triggers;

  const posValue = positionMarketValueFor(params.positions, params.symbol);
  const exposure = computeSymbolExposure(params.symbol, others, posValue);
  const nextTotal = totalSymbolExposure(exposure) + params.notionalUsd;

  if (nextTotal > params.settings.maxSymbolExposureUsd) {
    return {
      ok: false,
      error: `Guardrail: ${params.symbol.trim().toUpperCase()} would exceed $${params.settings.maxSymbolExposureUsd.toLocaleString()} total exposure (open position + armed buys). Lower size or trim other rules.`,
    };
  }

  return { ok: true };
}

/** Fire-time checks before a trigger paper buy executes. */
export function shouldBlockTriggerBuyFire(params: {
  settings: TriggerGuardrailSettings;
  symbol: string;
  notionalUsd: number;
  triggers: ReadonlyArray<DeskTrigger>;
  positions?: ReadonlyArray<{ symbol: string; marketValue: number }>;
  totalUnrealizedPnlPct?: number;
  buysToday: TriggerBuyDayStats;
}): { blocked: false } | { blocked: true; reason: string } {
  if (!params.settings.guardrailsEnabled) {
    return { blocked: false };
  }

  const bookDown = params.totalUnrealizedPnlPct ?? 0;
  if (bookDown <= -params.settings.pauseTriggerBuysWhenBookDownPct) {
    return {
      blocked: true,
      reason: `Guardrail: book is down ${Math.abs(bookDown).toFixed(1)}% — pausing new trigger buys until it recovers.`,
    };
  }

  if (params.buysToday.count >= params.settings.maxTriggerBuysPerDay) {
    return {
      blocked: true,
      reason: `Guardrail: daily trigger-buy cap hit (${params.settings.maxTriggerBuysPerDay}/day).`,
    };
  }

  if (
    params.buysToday.spendUsd + params.notionalUsd >
    params.settings.maxTriggerSpendPerDayUsd
  ) {
    return {
      blocked: true,
      reason: `Guardrail: would exceed $${params.settings.maxTriggerSpendPerDayUsd.toLocaleString()} trigger spend today.`,
    };
  }

  const posValue = positionMarketValueFor(params.positions, params.symbol);
  const exposure = computeSymbolExposure(
    params.symbol,
    params.triggers,
    posValue,
  );
  const nextTotal = totalSymbolExposure(exposure) + params.notionalUsd;
  if (nextTotal > params.settings.maxSymbolExposureUsd) {
    return {
      blocked: true,
      reason: `Guardrail: ${params.symbol} exposure would exceed $${params.settings.maxSymbolExposureUsd.toLocaleString()}.`,
    };
  }

  return { blocked: false };
}

export function formatGuardrailsSummary(settings: TriggerGuardrailSettings): string {
  if (!settings.guardrailsEnabled) return "Guardrails off";
  return [
    `max $${settings.maxSymbolExposureUsd.toLocaleString()}/symbol`,
    `${settings.maxTriggerBuysPerDay} trigger buys/day`,
    `$${settings.maxTriggerSpendPerDayUsd.toLocaleString()} trigger spend/day`,
    `pause buys if book ≤ −${settings.pauseTriggerBuysWhenBookDownPct}%`,
  ].join(" · ");
}
