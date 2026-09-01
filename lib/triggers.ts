/** Keep in sync with `MAX_USER_TRIGGERS` in `lib/limits.ts`. */
const MAX_TRIGGERS_CAP = 15;

export type TriggerConditionKind =
  | "day_drop_pct"
  | "day_gain_pct"
  | "price_below"
  | "price_above"
  | "profit_usd_above"
  | "profit_pct_above";

export type TriggerCondition = {
  kind: TriggerConditionKind;
  /** Percent points (3 = 3%) or absolute price, depending on kind. */
  value: number;
};

export type TriggerAction = "attention" | "paper_buy" | "paper_sell";

/** How much of the symbol to close when a paper_sell trigger fires. */
export type TriggerSellCloseMode = "all" | "pct" | "usd";

export type DeskTrigger = {
  id: string;
  symbol: string;
  exchange: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  /** Paper-buy notional in USD when action is paper_buy. */
  notionalUsd: number;
  /** paper_sell: close entire symbol (all lots) or partial on the newest lot. */
  sellCloseMode: TriggerSellCloseMode;
  /** paper_sell partial: percent (1–99) or USD notional when mode is pct/usd. */
  sellCloseValue: number;
  /** When true, rule auto-pauses after a successful fire (trade or alert). */
  autoPauseAfterFire: boolean;
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
};

export const DEFAULT_TRIGGER_NOTIONAL_USD = 1_000;
export const MAX_TRIGGER_NOTIONAL_USD = 5_000;
export const MAX_TRIGGER_SELL_CLOSE_USD = 50_000;

const SELL_CLOSE_MODES = new Set<TriggerSellCloseMode>(["all", "pct", "usd"]);

export class TriggerLimitError extends Error {
  readonly limit: number;
  readonly current: number;

  constructor(current: number, limit = MAX_TRIGGERS_CAP) {
    super(
      `Triggers are full (${current}/${limit}). Remove one before adding another.`,
    );
    this.name = "TriggerLimitError";
    this.limit = limit;
    this.current = current;
  }
}

const CONDITION_KINDS = new Set<TriggerConditionKind>([
  "day_drop_pct",
  "day_gain_pct",
  "price_below",
  "price_above",
  "profit_usd_above",
  "profit_pct_above",
]);

const ACTIONS = new Set<TriggerAction>([
  "attention",
  "paper_buy",
  "paper_sell",
]);

function newTriggerId(): string {
  return `trg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Human-readable reject reason for invalid trigger thresholds. */
export const TRIGGER_CONDITION_HINT =
  "Threshold must be a positive number — same as the Add → Trigger form. " +
  "For day drop/gain use percent points (3 = −3% / +3% day). " +
  "For profit rules use USD (28) or profit % (5 = +5% on your lot). " +
  "Do not use 0 or 'any negative'; ask for a concrete % or price.";

/**
 * Normalize condition payload. Day % kinds accept a mistaken negative magnitude
 * (−3 → 3) so clients/models that mirror the signed % still work; 0 is never valid.
 */
export function normalizeTriggerCondition(
  raw: unknown,
): TriggerCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const kind = rec.kind;
  let value = typeof rec.value === "number" ? rec.value : Number(rec.value);
  if (typeof kind !== "string" || !CONDITION_KINDS.has(kind as TriggerConditionKind)) {
    return null;
  }
  if (!Number.isFinite(value)) return null;

  const isDayPct = kind === "day_drop_pct" || kind === "day_gain_pct";
  const isProfitPct = kind === "profit_pct_above";
  const isProfitUsd = kind === "profit_usd_above";
  if (isDayPct) {
    value = Math.abs(value);
    if (value <= 0 || value > 90) return null;
  } else if (isProfitPct) {
    value = Math.abs(value);
    if (value <= 0 || value > 500) return null;
  } else if (isProfitUsd) {
    value = Math.abs(value);
    if (value < 1 || value > 50_000) return null;
  } else if (value <= 0) {
    return null;
  }

  return { kind: kind as TriggerConditionKind, value };
}

export function normalizeTriggerAction(raw: unknown): TriggerAction | null {
  if (typeof raw !== "string" || !ACTIONS.has(raw as TriggerAction)) return null;
  return raw as TriggerAction;
}

export function defaultAutoPauseAfterFire(action: TriggerAction): boolean {
  return action === "paper_buy" || action === "paper_sell";
}

export function normalizeAutoPauseAfterFire(
  raw: unknown,
  action: TriggerAction,
): boolean {
  if (typeof raw === "boolean") return raw;
  return defaultAutoPauseAfterFire(action);
}

function triggerSymbolsMatch(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replaceAll("/", "") === right.replaceAll("/", "");
}

/** All triggers on a symbol (enabled or paused). */
export function findTriggersForSymbol(
  triggers: ReadonlyArray<DeskTrigger>,
  symbol: string,
): DeskTrigger[] {
  return triggers.filter((t) => triggerSymbolsMatch(t.symbol, symbol));
}

export function normalizeNotionalUsd(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TRIGGER_NOTIONAL_USD;
  return Math.min(MAX_TRIGGER_NOTIONAL_USD, Math.max(25, Math.round(n)));
}

export function defaultSellCloseMode(action: TriggerAction): TriggerSellCloseMode {
  return action === "paper_sell" ? "all" : "all";
}

export function normalizeSellCloseMode(
  raw: unknown,
  action: TriggerAction,
): TriggerSellCloseMode {
  if (action !== "paper_sell") return "all";
  if (typeof raw === "string" && SELL_CLOSE_MODES.has(raw as TriggerSellCloseMode)) {
    return raw as TriggerSellCloseMode;
  }
  return "all";
}

export function normalizeSellCloseValue(
  raw: unknown,
  mode: TriggerSellCloseMode,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return mode === "pct" ? 50 : 500;
  if (mode === "pct") {
    return Math.min(99, Math.max(1, Math.round(n)));
  }
  if (mode === "usd") {
    return Math.min(MAX_TRIGGER_SELL_CLOSE_USD, Math.max(1, Math.round(n)));
  }
  return 0;
}

export function normalizeTriggerSellClose(
  action: TriggerAction,
  modeRaw: unknown,
  valueRaw: unknown,
): { sellCloseMode: TriggerSellCloseMode; sellCloseValue: number } {
  const sellCloseMode = normalizeSellCloseMode(modeRaw, action);
  const sellCloseValue =
    sellCloseMode === "all"
      ? 0
      : normalizeSellCloseValue(valueRaw, sellCloseMode);
  return { sellCloseMode, sellCloseValue };
}

export function normalizeDeskTrigger(raw: unknown): DeskTrigger | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const symbol =
    typeof rec.symbol === "string" ? rec.symbol.trim().toUpperCase() : "";
  if (!symbol) return null;
  const condition = normalizeTriggerCondition(rec.condition);
  const action = normalizeTriggerAction(rec.action);
  if (!condition || !action) return null;

  const id =
    typeof rec.id === "string" && rec.id.trim()
      ? rec.id.trim()
      : newTriggerId();
  const exchange =
    typeof rec.exchange === "string" && rec.exchange.trim()
      ? rec.exchange.trim().toUpperCase()
      : "NASDAQ";
  const createdAt =
    typeof rec.createdAt === "string" && rec.createdAt
      ? rec.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rec.updatedAt === "string" && rec.updatedAt
      ? rec.updatedAt
      : createdAt;
  const lastFiredAt =
    typeof rec.lastFiredAt === "string" ? rec.lastFiredAt : null;
  const sellClose = normalizeTriggerSellClose(
    action,
    rec.sellCloseMode,
    rec.sellCloseValue,
  );

  return {
    id,
    symbol,
    exchange,
    condition,
    action,
    enabled: rec.enabled !== false,
    notionalUsd: normalizeNotionalUsd(rec.notionalUsd),
    sellCloseMode: sellClose.sellCloseMode,
    sellCloseValue: sellClose.sellCloseValue,
    autoPauseAfterFire: normalizeAutoPauseAfterFire(rec.autoPauseAfterFire, action),
    createdAt,
    updatedAt,
    lastFiredAt,
  };
}

export function normalizeTriggerList(raw: unknown): DeskTrigger[] {
  if (!Array.isArray(raw)) return [];
  const out: DeskTrigger[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = normalizeDeskTrigger(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function buildDeskTrigger(input: {
  symbol: string;
  exchange?: string;
  condition: TriggerCondition;
  action: TriggerAction;
  notionalUsd?: number;
  sellCloseMode?: TriggerSellCloseMode;
  sellCloseValue?: number;
  enabled?: boolean;
  autoPauseAfterFire?: boolean;
}): DeskTrigger {
  const now = new Date().toISOString();
  const action = input.action;
  const sellClose = normalizeTriggerSellClose(
    action,
    input.sellCloseMode,
    input.sellCloseValue,
  );
  return {
    id: newTriggerId(),
    symbol: input.symbol.trim().toUpperCase(),
    exchange: (input.exchange ?? "NASDAQ").trim().toUpperCase() || "NASDAQ",
    condition: input.condition,
    action,
    enabled: input.enabled !== false,
    notionalUsd: normalizeNotionalUsd(input.notionalUsd),
    sellCloseMode: sellClose.sellCloseMode,
    sellCloseValue: sellClose.sellCloseValue,
    autoPauseAfterFire:
      input.autoPauseAfterFire ?? defaultAutoPauseAfterFire(action),
    createdAt: now,
    updatedAt: now,
    lastFiredAt: null,
  };
}

export function isProfitTriggerCondition(kind: TriggerConditionKind): boolean {
  return kind === "profit_usd_above" || kind === "profit_pct_above";
}

export function validateConditionActionPair(
  action: TriggerAction,
  condition: TriggerCondition,
): { ok: true } | { ok: false; error: string } {
  if (isProfitTriggerCondition(condition.kind) && action !== "paper_sell") {
    return {
      ok: false,
      error:
        "Profit conditions (profit ≥ $ or %) only work with Paper sell — pick that action or use a market When rule.",
    };
  }
  return { ok: true };
}

export type TriggerPositionContext = {
  unrealizedPnl: number;
  unrealizedPnlPct: number;
};

export function triggerConditionMet(
  condition: TriggerCondition,
  snapshot: { changePct: number; currentPrice: number },
  position?: TriggerPositionContext | null,
): boolean {
  switch (condition.kind) {
    case "day_drop_pct":
      return snapshot.changePct <= -condition.value;
    case "day_gain_pct":
      return snapshot.changePct >= condition.value;
    case "price_below":
      return snapshot.currentPrice <= condition.value;
    case "price_above":
      return snapshot.currentPrice >= condition.value;
    case "profit_usd_above":
      return (
        position != null && position.unrealizedPnl >= condition.value
      );
    case "profit_pct_above":
      return (
        position != null && position.unrealizedPnlPct >= condition.value
      );
    default:
      return false;
  }
}

export function formatTriggerCondition(condition: TriggerCondition): string {
  switch (condition.kind) {
    case "day_drop_pct":
      return `day ≤ −${condition.value}%`;
    case "day_gain_pct":
      return `day ≥ +${condition.value}%`;
    case "price_below":
      return `price ≤ ${condition.value}`;
    case "price_above":
      return `price ≥ ${condition.value}`;
    case "profit_usd_above":
      return `profit ≥ $${condition.value.toLocaleString()}`;
    case "profit_pct_above":
      return `profit ≥ +${condition.value}%`;
    default:
      return "condition";
  }
}

export function formatTriggerAction(action: TriggerAction): string {
  switch (action) {
    case "attention":
      return "Alert me";
    case "paper_buy":
      return "Paper buy";
    case "paper_sell":
      return "Paper sell";
    default:
      return action;
  }
}

function formatNotionalShort(usd: number): string {
  if (usd >= 1000 && usd % 1000 === 0) return `$${usd / 1000}k`;
  return `$${usd.toLocaleString()}`;
}

/** Display notional for trigger cards and detail. */
export function formatTriggerNotional(usd: number): string {
  return formatNotionalShort(usd);
}

export function formatTriggerSellClose(trigger: DeskTrigger): string {
  if (trigger.action !== "paper_sell" || trigger.sellCloseMode === "all") {
    return "all";
  }
  if (trigger.sellCloseMode === "pct") {
    return `${trigger.sellCloseValue}%`;
  }
  return formatNotionalShort(trigger.sellCloseValue);
}

export function formatTriggerActionDetail(trigger: DeskTrigger): string {
  if (trigger.action === "paper_buy") {
    return `Paper buy ${formatNotionalShort(trigger.notionalUsd)}`;
  }
  if (trigger.action === "paper_sell") {
    if (trigger.sellCloseMode === "all") {
      return "Paper sell all";
    }
    if (trigger.sellCloseMode === "pct") {
      return `Paper sell ${trigger.sellCloseValue}%`;
    }
    return `Paper sell ${formatNotionalShort(trigger.sellCloseValue)}`;
  }
  return formatTriggerAction(trigger.action);
}

export function formatTriggerSummary(trigger: DeskTrigger): string {
  const pause =
    trigger.autoPauseAfterFire ? " · pause after fire" : "";
  return `${trigger.symbol} · ${formatTriggerCondition(trigger.condition)} · ${formatTriggerActionDetail(trigger)}${pause}${trigger.enabled ? "" : " · off"}`;
}

/** Merge watchlist + trigger coverage symbols (cron must scan trigger-only names). */
export function mergeScanUniverse<
  T extends { symbol: string; exchange: string; addedAt: string },
>(watchlist: T[], coverage: T[]): T[] {
  const bySymbol = new Map<string, T>();
  for (const entry of [...watchlist, ...coverage]) {
    const sym = entry.symbol.trim().toUpperCase();
    if (!sym || bySymbol.has(sym)) continue;
    bySymbol.set(sym, {
      ...entry,
      symbol: sym,
      exchange: entry.exchange?.trim().toUpperCase() || "NASDAQ",
      addedAt: entry.addedAt || new Date().toISOString(),
    });
  }
  return [...bySymbol.values()];
}
