/** Keep in sync with `MAX_USER_TRIGGERS` in `lib/limits.ts`. */
const MAX_TRIGGERS_CAP = 15;

export type TriggerConditionKind =
  | "day_drop_pct"
  | "day_gain_pct"
  | "price_below"
  | "price_above";

export type TriggerCondition = {
  kind: TriggerConditionKind;
  /** Percent points (3 = 3%) or absolute price, depending on kind. */
  value: number;
};

export type TriggerAction = "attention" | "paper_buy" | "paper_sell";

export type DeskTrigger = {
  id: string;
  symbol: string;
  exchange: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  /** Paper-buy notional in USD when action is paper_buy. */
  notionalUsd: number;
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
};

export const DEFAULT_TRIGGER_NOTIONAL_USD = 1_000;
export const MAX_TRIGGER_NOTIONAL_USD = 5_000;

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
  "Do not use 0 or 'any negative'; ask for a concrete % (e.g. 1, 2, 3) or price.";

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
  if (isDayPct) {
    value = Math.abs(value);
    if (value <= 0 || value > 90) return null;
  } else if (value <= 0) {
    return null;
  }

  return { kind: kind as TriggerConditionKind, value };
}

export function normalizeTriggerAction(raw: unknown): TriggerAction | null {
  if (typeof raw !== "string" || !ACTIONS.has(raw as TriggerAction)) return null;
  return raw as TriggerAction;
}

export function normalizeNotionalUsd(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TRIGGER_NOTIONAL_USD;
  return Math.min(MAX_TRIGGER_NOTIONAL_USD, Math.max(25, Math.round(n)));
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

  return {
    id,
    symbol,
    exchange,
    condition,
    action,
    enabled: rec.enabled !== false,
    notionalUsd: normalizeNotionalUsd(rec.notionalUsd),
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
  enabled?: boolean;
}): DeskTrigger {
  const now = new Date().toISOString();
  return {
    id: newTriggerId(),
    symbol: input.symbol.trim().toUpperCase(),
    exchange: (input.exchange ?? "NASDAQ").trim().toUpperCase() || "NASDAQ",
    condition: input.condition,
    action: input.action,
    enabled: input.enabled !== false,
    notionalUsd: normalizeNotionalUsd(input.notionalUsd),
    createdAt: now,
    updatedAt: now,
    lastFiredAt: null,
  };
}

export function triggerConditionMet(
  condition: TriggerCondition,
  snapshot: { changePct: number; currentPrice: number },
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

export function formatTriggerActionDetail(trigger: DeskTrigger): string {
  if (trigger.action === "paper_buy") {
    return `Paper buy ${formatNotionalShort(trigger.notionalUsd)}`;
  }
  return formatTriggerAction(trigger.action);
}

export function formatTriggerSummary(trigger: DeskTrigger): string {
  return `${trigger.symbol} · ${formatTriggerCondition(trigger.condition)} · ${formatTriggerActionDetail(trigger)}${trigger.enabled ? "" : " · off"}`;
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
