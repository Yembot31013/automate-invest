export type DeedPhase = "running" | "done" | "error";

export type DeskDeed = {
  /** Short product line shown in chat */
  label: string;
  /** Hover / a11y detail — specific subject + outcome */
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

function asRec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

function joinSymbols(symbols: string[]): string {
  const clean = symbols.map(normalizeSymbol).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function compactSymbolLabel(symbols: string[]): string | null {
  const clean = symbols.map(normalizeSymbol).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]!;
  return `${clean[0]} +${clean.length - 1}`;
}

function inputSymbols(input: unknown): string[] {
  const rec = asRec(input);
  if (!rec) return [];
  if (typeof rec.symbol === "string" && rec.symbol.trim()) {
    return [normalizeSymbol(rec.symbol)];
  }
  if (Array.isArray(rec.symbols)) {
    return rec.symbols
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(normalizeSymbol);
  }
  return [];
}

function money(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: abs < 10 && abs !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

function qty(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function outputError(output: unknown): string | null {
  const rec = asRec(output);
  if (!rec) return null;
  if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
  if (typeof rec.message === "string" && rec.message.trim()) {
    return rec.message.trim();
  }
  return null;
}

function closedSymbolsFromOutput(output: unknown): string[] {
  const rec = asRec(output);
  if (!rec || !Array.isArray(rec.closed)) return [];
  return rec.closed
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const symbol = (row as Record<string, unknown>).symbol;
      return typeof symbol === "string" ? normalizeSymbol(symbol) : null;
    })
    .filter((s): s is string => Boolean(s));
}

function monitorResultSymbols(output: unknown): {
  ok: string[];
  failed: string[];
} {
  const rec = asRec(output);
  if (!rec || !Array.isArray(rec.results)) return { ok: [], failed: [] };
  const ok: string[] = [];
  const failed: string[] = [];
  for (const row of rec.results) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol =
      typeof r.symbol === "string" ? normalizeSymbol(r.symbol) : null;
    if (!symbol) continue;
    if (r.ok === false) failed.push(symbol);
    else ok.push(symbol);
  }
  return { ok, failed };
}

function pickLabelSubject(input: unknown, output?: unknown): string | null {
  const rec = asRec(input);
  if (rec?.sellAll === true) return "all";

  const closed = closedSymbolsFromOutput(output);
  if (closed.length > 0) return compactSymbolLabel(closed);

  const symbols = inputSymbols(input);
  if (symbols.length > 0) return compactSymbolLabel(symbols);

  return null;
}

function toolOutputFailed(toolName: string, output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const rec = output as Record<string, unknown>;
  if (toolName === "unmonitorSymbol") {
    return rec.removed === false;
  }
  if (
    toolName === "monitorSymbol" ||
    toolName === "monitorSymbols" ||
    toolName === "paperBuy" ||
    toolName === "paperSell" ||
    toolName === "paperSellMany" ||
    toolName === "createTrigger" ||
    toolName === "setTriggerEnabled" ||
    toolName === "removeTrigger"
  ) {
    return rec.ok === false;
  }
  return false;
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
  getDeskAutomation: {
    running: "Checking Auto / Attention…",
    done: "Automation status checked",
    error: "Couldn't read automation status",
  },
  listTriggers: {
    running: "Checking your triggers…",
    done: "Triggers checked",
    error: "Couldn't read triggers",
  },
  createTrigger: {
    running: "Arming a trigger…",
    done: "Trigger armed",
    error: "Couldn't create that trigger",
  },
  setTriggerEnabled: {
    running: "Updating a trigger…",
    done: "Trigger updated",
    error: "Couldn't update that trigger",
  },
  removeTrigger: {
    running: "Removing a trigger…",
    done: "Trigger removed",
    error: "Couldn't remove that trigger",
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
  paperSellMany: {
    running: "Clearing paper tickets…",
    done: "Paper sells filled",
    error: "Paper sells didn't go through",
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
  if (base.endsWith("…")) {
    return `${base.slice(0, -1)} · ${symbol}`;
  }
  return `${base} · ${symbol}`;
}

function deedHint(params: {
  toolName: string;
  phase: DeedPhase;
  input?: unknown;
  output?: unknown;
}): string {
  const { toolName, phase, input, output } = params;
  const inRec = asRec(input);
  const outRec = asRec(output);
  const symbols = inputSymbols(input);
  const subject = joinSymbols(symbols);
  const err = outputError(output);

  switch (toolName) {
    case "getSnapshot": {
      const sym = subject || "that ticker";
      if (phase === "running") return `Checking tape + headlines for ${sym}`;
      if (phase === "error") {
        return err ? `Couldn't read tape for ${sym}: ${err}` : `Couldn't read tape for ${sym}`;
      }
      return `Checked tape + headlines for ${sym}`;
    }
    case "listWatchlist": {
      if (phase === "running") return "Reading your watchlist";
      if (phase === "error") return err ?? "Couldn't read your watchlist";
      const count =
        outRec && Array.isArray(outRec.watchlist)
          ? outRec.watchlist.length
          : null;
      return count == null
        ? "Read your watchlist"
        : `Read your watchlist (${count} ticker${count === 1 ? "" : "s"})`;
    }
    case "getDeskAutomation": {
      if (phase === "running") return "Checking Auto-trade and Attention mail";
      if (phase === "error") return err ?? "Couldn't read automation status";
      const on = outRec?.autoTradeEnabled === true;
      return on
        ? "Auto-trade is ON · Attention mail still used when unsure"
        : "Auto-trade is OFF · Attention mail only";
    }
    case "listTriggers": {
      if (phase === "running") return "Reading your triggers";
      if (phase === "error") return err ?? "Couldn't read triggers";
      const count = Array.isArray(outRec?.triggers)
        ? outRec.triggers.length
        : null;
      return count == null
        ? "Read your triggers"
        : `Read your triggers (${count})`;
    }
    case "createTrigger": {
      if (phase === "running") return "Arming a trigger";
      if (phase === "error") return err ?? "Couldn't create trigger";
      const summary =
        typeof outRec?.summary === "string" ? outRec.summary : null;
      return summary ? `Armed trigger · ${summary}` : "Armed a trigger";
    }
    case "setTriggerEnabled": {
      if (phase === "running") return "Updating a trigger";
      if (phase === "error") return err ?? "Couldn't update trigger";
      const summary =
        typeof outRec?.summary === "string" ? outRec.summary : null;
      const enabled = outRec?.trigger && typeof outRec.trigger === "object"
        ? (outRec.trigger as { enabled?: boolean }).enabled
        : undefined;
      if (summary) {
        return enabled === false
          ? `Paused trigger · ${summary}`
          : `Enabled trigger · ${summary}`;
      }
      return "Updated a trigger";
    }
    case "removeTrigger": {
      if (phase === "running") return "Removing a trigger";
      if (phase === "error") return err ?? "Couldn't remove trigger";
      const summary =
        typeof outRec?.summary === "string" ? outRec.summary : null;
      return summary ? `Removed trigger · ${summary}` : "Removed a trigger";
    }
    case "monitorSymbol": {
      const sym =
        (typeof outRec?.symbol === "string" && normalizeSymbol(outRec.symbol)) ||
        subject ||
        "that ticker";
      if (phase === "running") return `Pinning ${sym} to the watchlist`;
      if (phase === "error") {
        return err ? `Couldn't pin ${sym}: ${err}` : `Couldn't pin ${sym}`;
      }
      if (outRec?.alreadyWatched === true) {
        return `${sym} was already on the watchlist`;
      }
      return `Pinned ${sym} to the watchlist`;
    }
    case "monitorSymbols": {
      const { ok, failed } = monitorResultSymbols(output);
      const asked = subject || joinSymbols(ok.length ? ok : symbols);
      if (phase === "running") {
        return asked
          ? `Pinning ${asked} to the watchlist`
          : "Pinning tickers to the watchlist";
      }
      if (phase === "error") {
        const failList = joinSymbols(failed) || asked || "those tickers";
        return err
          ? `Couldn't pin ${failList}: ${err}`
          : `Couldn't pin ${failList}`;
      }
      const pinned = joinSymbols(ok) || asked;
      if (failed.length > 0) {
        return `Pinned ${pinned || "none"} · failed: ${joinSymbols(failed)}`;
      }
      return pinned
        ? `Pinned ${pinned} to the watchlist`
        : "Updated the watchlist";
    }
    case "unmonitorSymbol": {
      const sym =
        (typeof outRec?.symbol === "string" && normalizeSymbol(outRec.symbol)) ||
        subject ||
        "that ticker";
      if (phase === "running") return `Removing ${sym} from the watchlist`;
      if (phase === "error" || outRec?.removed === false) {
        if (outRec?.wasPresent === false) {
          return `${sym} wasn't on the watchlist`;
        }
        return err ? `Couldn't remove ${sym}: ${err}` : `Couldn't remove ${sym}`;
      }
      return `Removed ${sym} from the watchlist`;
    }
    case "recommend": {
      if (phase === "running") return "Ranking your watchlist for dip/breakout picks";
      if (phase === "error") return err ?? "Couldn't rank your watchlist";
      const count =
        typeof outRec?.count === "number"
          ? outRec.count
          : Array.isArray(outRec?.recommendations)
            ? outRec.recommendations.length
            : null;
      if (count === 0) return "No watchlist picks right now";
      if (count == null) return "Watchlist picks ready";
      return `Ranked ${count} watchlist pick${count === 1 ? "" : "s"}`;
    }
    case "paperBuy": {
      const sym =
        (typeof outRec?.symbol === "string" && normalizeSymbol(outRec.symbol)) ||
        subject ||
        "that ticker";
      const quantity = qty(outRec?.quantity ?? inRec?.quantity);
      const size = quantity ? `${quantity} ${sym}` : sym;
      if (phase === "running") return `Paper buying ${size}`;
      if (phase === "error") {
        return err ? `Paper buy failed for ${size}: ${err}` : `Paper buy failed for ${size}`;
      }
      const entry = money(outRec?.entryPrice ?? outRec?.markPrice);
      const cash = money(outRec?.cashRemaining);
      const bits = [`Paper bought ${size}`];
      if (entry) bits.push(`@ ${entry}`);
      if (cash) bits.push(`cash left ${cash}`);
      return bits.join(" · ");
    }
    case "paperSell": {
      const sym =
        (typeof outRec?.symbol === "string" && normalizeSymbol(outRec.symbol)) ||
        subject ||
        "that ticker";
      if (phase === "running") return `Paper selling ${sym}`;
      if (phase === "error") {
        return err
          ? `Paper sell failed for ${sym}: ${err}`
          : `Paper sell failed for ${sym}`;
      }
      const exit = money(outRec?.exitPrice);
      const pnl = money(outRec?.unrealizedPnl);
      const cash = money(outRec?.cashRemaining);
      const bits = [`Paper sold ${sym}`];
      if (exit) bits.push(`@ ${exit}`);
      if (pnl) bits.push(`PnL ${pnl}`);
      if (cash) bits.push(`cash ${cash}`);
      return bits.join(" · ");
    }
    case "paperSellMany": {
      const closed = closedSymbolsFromOutput(output);
      const sellAll = inRec?.sellAll === true;
      const named =
        joinSymbols(closed) ||
        subject ||
        (sellAll ? "all open positions" : "those positions");
      if (phase === "running") {
        return sellAll && !subject
          ? "Paper selling all open positions"
          : `Paper selling ${named}`;
      }
      if (phase === "error") {
        return err
          ? `Paper sells failed (${named}): ${err}`
          : `Paper sells failed for ${named}`;
      }
      const closedCount =
        typeof outRec?.closedCount === "number"
          ? outRec.closedCount
          : closed.length;
      const remaining =
        typeof outRec?.remainingOpen === "number" ? outRec.remainingOpen : null;
      const soldList =
        joinSymbols(closed) ||
        (sellAll ? `${closedCount} position${closedCount === 1 ? "" : "s"}` : named);
      if (closedCount === 0) {
        return err || "No open paper positions were sold";
      }
      if (remaining === 0) {
        return `Paper sold ${soldList} · book is flat`;
      }
      if (remaining != null) {
        return `Paper sold ${soldList} · ${remaining} still open`;
      }
      return `Paper sold ${soldList}`;
    }
    case "portfolioPnL": {
      if (phase === "running") return "Marking your paper book to market";
      if (phase === "error") return err ?? "Couldn't mark the paper book";
      const equity = money(outRec?.equity);
      const cash = money(outRec?.cash);
      const pnl = money(outRec?.totalUnrealizedPnl);
      const openCount =
        typeof outRec?.openCount === "number" ? outRec.openCount : null;
      const bits = ["Paper book marked"];
      if (equity) bits.push(`equity ${equity}`);
      if (cash) bits.push(`cash ${cash}`);
      if (openCount != null) {
        bits.push(`${openCount} open`);
      }
      if (pnl) bits.push(`PnL ${pnl}`);
      return bits.join(" · ");
    }
    case "whatIf": {
      const sym = subject || "that ticker";
      const quantity = qty(inRec?.quantity) ?? "1";
      const entryDate =
        typeof inRec?.entryDate === "string" ? inRec.entryDate : null;
      const setup = entryDate
        ? `${quantity} ${sym} from ${entryDate}`
        : `${quantity} ${sym}`;
      if (phase === "running") return `Running what-if on ${setup}`;
      if (phase === "error") {
        return err ? `What-if failed for ${setup}: ${err}` : `What-if failed for ${setup}`;
      }
      const pnl = money(outRec?.pnl);
      return pnl ? `What-if ready for ${setup} · PnL ${pnl}` : `What-if ready for ${setup}`;
    }
    case "lookupForex": {
      const currency =
        (typeof outRec?.currency === "string" && outRec.currency.toUpperCase()) ||
        (typeof inRec?.currency === "string" && inRec.currency.toUpperCase()) ||
        "USD";
      const pair =
        (typeof outRec?.pair === "string" && outRec.pair) || `${currency}/NGN`;
      if (phase === "running") return `Checking live ${pair}`;
      if (phase === "error") {
        return err ? `Couldn't read ${pair}: ${err}` : `Couldn't read ${pair}`;
      }
      const rate =
        typeof outRec?.ngnPerUnit === "number"
          ? `₦${outRec.ngnPerUnit.toLocaleString("en-US", { maximumFractionDigits: 2 })} per 1 ${currency}`
          : null;
      const amountNgn =
        typeof inRec?.amountNgn === "number" ? money(inRec.amountNgn) : null;
      const bits = [`Live ${pair}`];
      if (rate) bits.push(rate);
      if (amountNgn) bits.push(`for ${amountNgn} NGN`);
      return bits.join(" · ");
    }
    case "reportCapabilityGap": {
      const title =
        (typeof inRec?.gapTitle === "string" && inRec.gapTitle.trim()) ||
        "capability gap";
      if (phase === "running") return `Flagging for the team: ${title}`;
      if (phase === "error") {
        return err
          ? `Couldn't flag gap (${title}): ${err}`
          : `Couldn't flag gap: ${title}`;
      }
      return `Flagged for the team: ${title}`;
    }
    default: {
      if (phase === "running") {
        return subject
          ? `Working on ${subject}`
          : "Sidekick is working a desk move";
      }
      if (phase === "error") {
        return err
          ? `Desk move failed${subject ? ` (${subject})` : ""}: ${err}`
          : `Desk move failed${subject ? ` for ${subject}` : ""}`;
      }
      return subject ? `Finished · ${subject}` : "Desk move finished";
    }
  }
}

/**
 * Map a raw AI tool part into a desk “deed” — product language, not ChatGPT chrome.
 */
export function deskDeedForTool(params: {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
}): DeskDeed {
  let phase = phaseFromState(params.state);
  if (phase === "done" && toolOutputFailed(params.toolName, params.output)) {
    phase = "error";
  }
  const subject = pickLabelSubject(params.input, params.output);
  const copy = DEED_COPY[params.toolName] ?? {
    running: "Working the desk…",
    done: "Desk move finished",
    error: "Desk move didn't work",
  };

  const label = withSymbol(
    phase === "running" ? copy.running : phase === "done" ? copy.done : copy.error,
    subject,
  );

  const hint = deedHint({
    toolName: params.toolName,
    phase,
    input: params.input,
    output: params.output,
  });

  return { label, hint, phase };
}
