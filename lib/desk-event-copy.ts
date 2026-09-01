import type { AlertType } from "@/types";

/** Short chip line (human) + hover detail (technical). */
export type DeskEventCopy = { text: string; hint: string };

function typeWord(type: AlertType): string {
  return type === "breakout" ? "breakout" : "dip";
}

export function attentionScanCopy(params: {
  symbol: string;
  type: AlertType;
  emailed: boolean;
  autoUnsure?: boolean;
}): DeskEventCopy {
  const { symbol, type, emailed, autoUnsure } = params;
  const move = typeWord(type);

  if (autoUnsure) {
    return {
      text: `${symbol} ${move} caught my eye — Auto passed, your call 👀`,
      hint: `Scan ${type} · Auto-trade on but did not paper-trade · ${emailed ? "Attention email sent" : "No email on file"}`,
    };
  }

  if (emailed) {
    return {
      text: `${symbol} ${move} while you were away — check your inbox 📬`,
      hint: `Cron scan flagged ${type} · Attention email sent · no trade`,
    };
  }

  return {
    text: `${symbol} ${move} popped on the scan — peek when you can`,
    hint: `Cron scan flagged ${type} · no email on file · no trade`,
  };
}

export function autoExitCopy(params: {
  symbol: string;
  reason: "stop" | "trail";
  pnlPct: number;
}): DeskEventCopy {
  const label = params.reason === "stop" ? "stop-loss" : "trail giveback";
  return {
    text: `Auto sold ${params.symbol} (${params.pnlPct >= 0 ? "+" : ""}${params.pnlPct.toFixed(1)}%) — ${label}`,
    hint: `Auto-trade exit · ${label} rule · paper sell filled`,
  };
}

export function autoEntryCopy(params: {
  symbol: string;
  quantity: number;
}): DeskEventCopy {
  return {
    text: `Auto paper-bought ${params.quantity} ${params.symbol} on that dip`,
    hint: "Auto-trade entry · watchlist dip rule · paper buy filled",
  };
}

export function autoSkipCopy(params: {
  symbol: string;
  reason: string;
}): DeskEventCopy {
  const lower = params.reason.toLowerCase();
  let text: string;
  if (lower.includes("won't chase") || lower.includes("breakout")) {
    text = `Nah — Auto won't chase ${params.symbol} breakouts`;
  } else if (lower.includes("daily auto-buy cap")) {
    text = `Auto skipped ${params.symbol} — hit today's buy cap`;
  } else if (lower.includes("trail giveback not hit")) {
    text = `${params.symbol} in profit — Auto holding for now`;
  } else {
    text = `Auto passed on ${params.symbol} — ${params.reason}`;
  }
  return {
    text,
    hint: `Auto-trade skipped · ${params.reason}`,
  };
}

export function autoEnabledCopy(): DeskEventCopy {
  return {
    text: "Auto-trade is ON — dips + exits only, breakouts still need you",
    hint: "User enabled Auto-trade after quiz · paper rules active",
  };
}

export function autoDisabledCopy(): DeskEventCopy {
  return {
    text: "Auto-trade off — Attention mail still watching the board",
    hint: "User disabled Auto-trade · scan alerts continue",
  };
}

export function triggerAttentionCopy(params: {
  summary: string;
  changePct: number;
}): DeskEventCopy {
  const sign = params.changePct >= 0 ? "+" : "";
  return {
    text: `Trigger ping — ${params.summary.split(" · ")[0] ?? "rule"} hit (${sign}${params.changePct.toFixed(1)}% day)`,
    hint: `${params.summary} · alert only unless action was paper buy/sell`,
  };
}

export function triggerBuyCopy(params: {
  symbol: string;
  qty: number;
  price: number;
  condition: string;
}): DeskEventCopy {
  return {
    text: `Trigger bought ${params.qty} ${params.symbol} @ ~$${params.price.toFixed(2)}`,
    hint: `User trigger fired · ${params.condition} · paper buy filled`,
  };
}

export function triggerSellCopy(params: {
  symbol: string;
  closedCount: number;
  condition: string;
}): DeskEventCopy {
  return {
    text: `Trigger closed ${params.closedCount} ${params.symbol} lot${params.closedCount === 1 ? "" : "s"}`,
    hint: `User trigger fired · ${params.condition} · paper sell filled`,
  };
}

export function triggerSkipCopy(params: {
  symbol: string;
  message: string;
}): DeskEventCopy {
  const msg = params.message.toLowerCase();
  let text: string;
  if (msg.includes("no open lot")) {
    text = `Trigger wanted to sell ${params.symbol} — you don't hold it`;
  } else if (msg.includes("cash")) {
    text = `Trigger buy on ${params.symbol} skipped — not enough cash`;
  } else {
    text = `Trigger on ${params.symbol} didn't fire — ${params.message}`;
  }
  return {
    text,
    hint: `User trigger condition met but action skipped · ${params.message}`,
  };
}
