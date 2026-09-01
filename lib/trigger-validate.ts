import {
  isProfitTriggerCondition,
  validateConditionActionPair,
  type DeskTrigger,
  type TriggerAction,
  type TriggerCondition,
} from "./triggers.ts";
import {
  validateTriggerGuardrails,
  type TriggerGuardrailSettings,
} from "./trigger-guardrails.ts";

export type TriggerBookContext = {
  cash: number;
  openSymbols: string[];
  positions?: ReadonlyArray<{
    symbol: string;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  }>;
  totalUnrealizedPnlPct?: number;
};

export class TriggerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerValidationError";
  }
}

function triggerSymbolsMatch(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replaceAll("/", "") === right.replaceAll("/", "");
}

export function normalizeOpenSymbols(
  positions: ReadonlyArray<{ symbol: string }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const sym = p.symbol.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export function bookOwnsSymbol(
  book: TriggerBookContext,
  symbol: string,
): boolean {
  return book.openSymbols.some((s) => triggerSymbolsMatch(s, symbol));
}

/** Exact rule already armed (same symbol + condition + action). */
export function findDuplicateTrigger(
  existing: ReadonlyArray<DeskTrigger>,
  candidate: {
    symbol: string;
    condition: TriggerCondition;
    action: TriggerAction;
  },
  excludeId?: string,
): DeskTrigger | null {
  const symbol = candidate.symbol.trim().toUpperCase();
  return (
    existing.find(
      (t) =>
        t.id !== excludeId &&
        triggerSymbolsMatch(t.symbol, symbol) &&
        t.action === candidate.action &&
        t.condition.kind === candidate.condition.kind &&
        t.condition.value === candidate.condition.value,
    ) ?? null
  );
}

/**
 * Both sides armed on day-drop buy + sell — can fire on the same red scan.
 * Brackets like dip buy + take-profit (day gain or profit %) are allowed.
 */
export function findSameDayDropCollision(
  existing: ReadonlyArray<DeskTrigger>,
  candidate: {
    symbol: string;
    action: TriggerAction;
    condition: TriggerCondition;
    enabled?: boolean;
  },
  excludeId?: string,
): DeskTrigger | null {
  if (candidate.enabled === false) return null;
  if (candidate.condition.kind !== "day_drop_pct") return null;
  if (candidate.action !== "paper_buy" && candidate.action !== "paper_sell") {
    return null;
  }
  const opposite: TriggerAction =
    candidate.action === "paper_buy" ? "paper_sell" : "paper_buy";
  const symbol = candidate.symbol.trim().toUpperCase();
  return (
    existing.find(
      (t) =>
        t.id !== excludeId &&
        t.enabled &&
        t.action === opposite &&
        t.condition.kind === "day_drop_pct" &&
        triggerSymbolsMatch(t.symbol, symbol),
    ) ?? null
  );
}

export function validateTriggerAgainstBook(params: {
  action: TriggerAction;
  symbol: string;
  notionalUsd: number;
  condition: TriggerCondition;
  book: TriggerBookContext;
}): { ok: true } | { ok: false; error: string } {
  const { action, symbol, notionalUsd, condition, book } = params;
  const pair = validateConditionActionPair(action, condition);
  if (!pair.ok) return pair;

  if (action === "paper_sell") {
    const canArmAhead =
      isProfitTriggerCondition(condition.kind) ||
      condition.kind === "day_gain_pct" ||
      condition.kind === "price_above";
    if (!canArmAhead && !bookOwnsSymbol(book, symbol)) {
      return {
        ok: false,
        error: `No open paper lot in ${symbol.trim().toUpperCase()} — buy some first, or pick take-profit / profit ≥ / Alert me.`,
      };
    }
  }
  if (action === "paper_buy") {
    if (book.cash < notionalUsd) {
      return {
        ok: false,
        error: `Not enough paper cash for a $${notionalUsd.toLocaleString()} buy (have $${Math.floor(book.cash).toLocaleString()}). Lower the size or free cash.`,
      };
    }
  }
  return { ok: true };
}

function runCreateChecks(params: {
  symbol: string;
  condition: TriggerCondition;
  action: TriggerAction;
  notionalUsd: number;
  enabled?: boolean;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
  guardrails?: TriggerGuardrailSettings;
  excludeId?: string;
}): { ok: true } | { ok: false; error: string } {
  const dup = findDuplicateTrigger(params.existing, params, params.excludeId);
  if (dup) {
    return {
      ok: false,
      error: `That rule already exists for ${dup.symbol} (${dup.enabled ? "on" : "paused"}). Edit or remove it instead.`,
    };
  }
  const dipCollision = findSameDayDropCollision(
    params.existing,
    {
      symbol: params.symbol,
      action: params.action,
      condition: params.condition,
      enabled: params.enabled ?? true,
    },
    params.excludeId,
  );
  if (dipCollision) {
    return {
      ok: false,
      error: `Collision: ${dipCollision.symbol} already has an enabled day-drop ${dipCollision.action === "paper_buy" ? "buy" : "sell"}. Use take-profit (day gain, profit ≥, or price) on the sell side instead.`,
    };
  }
  const bookCheck = validateTriggerAgainstBook({
    action: params.action,
    symbol: params.symbol,
    notionalUsd: params.notionalUsd,
    condition: params.condition,
    book: params.book,
  });
  if (!bookCheck.ok) return bookCheck;

  if (params.guardrails) {
    const guard = validateTriggerGuardrails({
      settings: params.guardrails,
      symbol: params.symbol,
      action: params.action,
      notionalUsd: params.notionalUsd,
      triggers: params.existing,
      positions: params.book.positions,
      excludeTriggerId: params.excludeId,
    });
    if (!guard.ok) return guard;
  }

  return { ok: true };
}

/** Create-time checks: book + duplicates + dip collision + guardrails. */
export function validateTriggerCreate(params: {
  symbol: string;
  condition: TriggerCondition;
  action: TriggerAction;
  notionalUsd: number;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
  guardrails?: TriggerGuardrailSettings;
}): { ok: true } | { ok: false; error: string } {
  return runCreateChecks({ ...params, enabled: true });
}

/** Re-run when turning a trigger back on or editing an armed rule. */
export function validateTriggerEnable(params: {
  trigger: DeskTrigger;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
  guardrails?: TriggerGuardrailSettings;
}): { ok: true } | { ok: false; error: string } {
  const { trigger, existing, book, guardrails } = params;
  return runCreateChecks({
    symbol: trigger.symbol,
    condition: trigger.condition,
    action: trigger.action,
    notionalUsd: trigger.notionalUsd,
    enabled: true,
    existing,
    book,
    guardrails,
    excludeId: trigger.id,
  });
}

/** Edit-time checks — same as create but excludes the trigger being updated. */
export function validateTriggerUpdate(params: {
  triggerId: string;
  symbol: string;
  condition: TriggerCondition;
  action: TriggerAction;
  notionalUsd: number;
  enabled: boolean;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
  guardrails?: TriggerGuardrailSettings;
}): { ok: true } | { ok: false; error: string } {
  if (!params.enabled) {
    const pair = validateConditionActionPair(params.action, params.condition);
    if (!pair.ok) return pair;
    return { ok: true };
  }
  return runCreateChecks({
    symbol: params.symbol,
    condition: params.condition,
    action: params.action,
    notionalUsd: params.notionalUsd,
    enabled: true,
    existing: params.existing,
    book: params.book,
    guardrails: params.guardrails,
    excludeId: params.triggerId,
  });
}

/** Which enabled triggers should turn off given the current paper book. */
export function triggersToAutoDisable(
  triggers: ReadonlyArray<DeskTrigger>,
  book: TriggerBookContext,
): DeskTrigger[] {
  return triggers.filter((t) => {
    if (!t.enabled) return false;
    if (t.action === "paper_sell" && !bookOwnsSymbol(book, t.symbol)) {
      return true;
    }
    if (t.action === "paper_buy" && book.cash < t.notionalUsd) {
      return true;
    }
    return false;
  });
}
