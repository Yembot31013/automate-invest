export type DeedPhase = "running" | "done" | "error";

export type DeskDeed = {
  /** Short product line shown in chat */
  label: string;
  /** Hover / a11y detail (may include technical tool name) */
  hint: string;
  phase: DeedPhase;
};

function phaseFromState(state: string): DeedPhase {
  const s = state.toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "error";
  if (
    s.includes("result") ||
    s.includes("complete") ||
    s.includes("output") ||
    s === "done"
  ) {
    return "done";
  }
  return "running";
}

function pickSymbol(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.symbol === "string" && rec.symbol.trim()) {
    return rec.symbol.trim().toUpperCase();
  }
  if (Array.isArray(rec.symbols) && rec.symbols.length > 0) {
    const first = rec.symbols.find((s) => typeof s === "string" && s.trim());
    if (typeof first === "string") {
      const rest = rec.symbols.length - 1;
      const head = first.trim().toUpperCase();
      return rest > 0 ? `${head} +${rest}` : head;
    }
  }
  return null;
}

type DeedCopy = { running: string; done: string; error: string };

const DEED_COPY: Record<string, DeedCopy> = {
  getSnapshot: {
    running: "Checking the tape…",
    done: "Tape + headlines checked",
    error: "Couldn't read the tape",
  },
  listWatchlist: {
    running: "Looking at your board…",
    done: "Board checked",
    error: "Couldn't read the board",
  },
  monitorSymbol: {
    running: "Pinning to the board…",
    done: "Pinned to the watchlist",
    error: "Couldn't pin that ticker",
  },
  monitorSymbols: {
    running: "Pinning a few to the board…",
    done: "Watchlist updated",
    error: "Couldn't pin those tickers",
  },
  unmonitorSymbol: {
    running: "Taking one off the board…",
    done: "Removed from the watchlist",
    error: "Couldn't remove that ticker",
  },
  recommend: {
    running: "Ranking your board…",
    done: "Picks ready",
    error: "Couldn't rank the board",
  },
  paperBuy: {
    running: "Filling a paper ticket…",
    done: "Paper buy filled",
    error: "Paper buy didn't go through",
  },
  paperSell: {
    running: "Closing a paper ticket…",
    done: "Paper sell filled",
    error: "Paper sell didn't go through",
  },
  portfolioPnL: {
    running: "Marking the paper book…",
    done: "Paper book marked",
    error: "Couldn't mark the paper book",
  },
  whatIf: {
    running: "Running a what-if…",
    done: "What-if ready",
    error: "What-if didn't finish",
  },
  reportCapabilityGap: {
    running: "Flagging a gap for the team…",
    done: "Gap flagged for the team",
    error: "Couldn't send the gap note",
  },
  lookupForex: {
    running: "Checking the FX board…",
    done: "FX rate ready",
    error: "Couldn't read the FX rate",
  },
};

function withSymbol(base: string, symbol: string | null): string {
  if (!symbol) return base;
  // Keep lines short — append once for context
  if (base.endsWith("…")) {
    return `${base.slice(0, -1)} · ${symbol}`;
  }
  return `${base} · ${symbol}`;
}

/**
 * Map a raw AI tool part into a desk “deed” — product language, not ChatGPT chrome.
 */
export function deskDeedForTool(params: {
  toolName: string;
  state: string;
  input?: unknown;
}): DeskDeed {
  const phase = phaseFromState(params.state);
  const symbol = pickSymbol(params.input);
  const copy = DEED_COPY[params.toolName] ?? {
    running: "Working the desk…",
    done: "Desk move finished",
    error: "Desk move didn't work",
  };

  const label = withSymbol(
    phase === "running" ? copy.running : phase === "done" ? copy.done : copy.error,
    symbol,
  );

  const hint =
    phase === "running"
      ? `Sidekick is working (${params.toolName})`
      : phase === "done"
        ? `Finished · ${params.toolName}`
        : `Problem · ${params.toolName}`;

  return { label, hint, phase };
}
