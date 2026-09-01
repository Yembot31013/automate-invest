import type {
  DeskTrigger,
  TriggerAction,
  TriggerCondition,
} from "@/lib/triggers";

export type TriggerBookContext = {
  cash: number;
  openSymbols: string[];
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
 * Opposing paper trade on the same name (buy vs sell) — only among enabled
 * rules, or the candidate if it would be enabled.
 */
export function findOpposingTradeTrigger(
  existing: ReadonlyArray<DeskTrigger>,
  candidate: { symbol: string; action: TriggerAction },
  excludeId?: string,
): DeskTrigger | null {
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
        triggerSymbolsMatch(t.symbol, symbol),
    ) ?? null
  );
}

export function validateTriggerAgainstBook(params: {
  action: TriggerAction;
  symbol: string;
  notionalUsd: number;
  book: TriggerBookContext;
}): { ok: true } | { ok: false; error: string } {
  const { action, symbol, notionalUsd, book } = params;
  if (action === "paper_sell") {
    if (!bookOwnsSymbol(book, symbol)) {
      return {
        ok: false,
        error: `No open paper lot in ${symbol.trim().toUpperCase()} — buy some first, or pick Alert me / Paper buy.`,
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

/** Create-time checks: book + duplicates + buy/sell conflict. */
export function validateTriggerCreate(params: {
  symbol: string;
  condition: TriggerCondition;
  action: TriggerAction;
  notionalUsd: number;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
}): { ok: true } | { ok: false; error: string } {
  const dup = findDuplicateTrigger(params.existing, params);
  if (dup) {
    return {
      ok: false,
      error: `That rule already exists for ${dup.symbol} (${dup.enabled ? "on" : "paused"}). Edit or remove it instead.`,
    };
  }
  const oppose = findOpposingTradeTrigger(params.existing, params);
  if (oppose) {
    return {
      ok: false,
      error: `Conflict: ${oppose.symbol} already has an enabled ${oppose.action === "paper_buy" ? "paper buy" : "paper sell"} trigger. Pause or remove it first.`,
    };
  }
  return validateTriggerAgainstBook(params);
}

/** Re-run when turning a trigger back on or editing an armed rule. */
export function validateTriggerEnable(params: {
  trigger: DeskTrigger;
  existing: ReadonlyArray<DeskTrigger>;
  book: TriggerBookContext;
}): { ok: true } | { ok: false; error: string } {
  const { trigger, existing, book } = params;
  const oppose = findOpposingTradeTrigger(
    existing,
    { symbol: trigger.symbol, action: trigger.action },
    trigger.id,
  );
  if (oppose) {
    return {
      ok: false,
      error: `Conflict: ${oppose.symbol} already has an enabled ${oppose.action === "paper_buy" ? "paper buy" : "paper sell"} trigger. Pause or remove it first.`,
    };
  }
  return validateTriggerAgainstBook({
    action: trigger.action,
    symbol: trigger.symbol,
    notionalUsd: trigger.notionalUsd,
    book,
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
}): { ok: true } | { ok: false; error: string } {
  const dup = findDuplicateTrigger(
    params.existing,
    {
      symbol: params.symbol,
      condition: params.condition,
      action: params.action,
    },
    params.triggerId,
  );
  if (dup) {
    return {
      ok: false,
      error: `That rule already exists for ${dup.symbol} (${dup.enabled ? "on" : "paused"}). Edit or remove the other one instead.`,
    };
  }
  if (params.enabled) {
    const oppose = findOpposingTradeTrigger(
      params.existing,
      { symbol: params.symbol, action: params.action },
      params.triggerId,
    );
    if (oppose) {
      return {
        ok: false,
        error: `Conflict: ${oppose.symbol} already has an enabled ${oppose.action === "paper_buy" ? "paper buy" : "paper sell"} trigger. Pause or remove it first.`,
      };
    }
    return validateTriggerAgainstBook({
      action: params.action,
      symbol: params.symbol,
      notionalUsd: params.notionalUsd,
      book: params.book,
    });
  }
  return { ok: true };
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
