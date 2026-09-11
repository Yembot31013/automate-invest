import type { OhlcBar } from "@/types";

import { detectBullishStructure } from "./bos-fvg-ob.ts";
import type { StructureTimeframe } from "./types.ts";

export type StructureBacktestTrade = {
  setupBarTime: number;
  entryBarTime: number;
  exitBarTime: number | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  exit: number | null;
  riskReward: number;
  /** Closed trade R multiple (positive = win). Null if still open. */
  rMultiple: number | null;
  outcome: "win" | "loss" | "open";
  obLow: number;
  obHigh: number;
};

export type StructureBacktestResult = {
  symbol: string;
  timeframe: StructureTimeframe;
  barCount: number;
  tradeCount: number;
  wins: number;
  losses: number;
  openTrades: number;
  winRatePct: number | null;
  avgR: number | null;
  totalR: number;
  trades: StructureBacktestTrade[];
  notes: string[];
};

function barTouchesZone(bar: OhlcBar, low: number, high: number): boolean {
  return bar.low <= high && bar.high >= low;
}

function fillInZone(bar: OhlcBar, obLow: number, obHigh: number): number {
  const mid = (obLow + obHigh) / 2;
  return Math.min(bar.high, Math.max(bar.low, mid));
}

/**
 * Walk historical bars and simulate bullish BOS+FVG+OB trades.
 * One position at a time. Entry on first touch of the order block after setup.
 * Same-bar SL+TP → count as loss (conservative). Simulation only — not live advice.
 */
export function backtestBullishStructure(params: {
  symbol: string;
  timeframe: StructureTimeframe;
  bars: OhlcBar[];
  /** Min bars before scanning (detector needs ~40). */
  minBars?: number;
  /** Cap returned trade list (newest last). */
  maxTradesListed?: number;
}): StructureBacktestResult {
  const {
    symbol,
    timeframe,
    bars,
    minBars = 40,
    maxTradesListed = 40,
  } = params;

  const notes: string[] = [
    "Simulation on historical OHLC — fills assume mid order-block on first touch.",
    "Same-bar stop and target → counted as a loss (conservative).",
    "One trade at a time; overlapping setups while in a trade are skipped.",
  ];

  if (bars.length < minBars) {
    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      barCount: bars.length,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      openTrades: 0,
      winRatePct: null,
      avgR: null,
      totalR: 0,
      trades: [],
      notes: [
        ...notes,
        `Need at least ${minBars} bars (have ${bars.length}).`,
      ],
    };
  }

  const trades: StructureBacktestTrade[] = [];
  const seenSetups = new Set<string>();

  let open: {
    setupKey: string;
    setupBarTime: number;
    entryBarTime: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    obLow: number;
    obHigh: number;
  } | null = null;

  let pending: {
    setupKey: string;
    setupBarTime: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    obLow: number;
    obHigh: number;
  } | null = null;

  for (let i = minBars - 1; i < bars.length; i += 1) {
    const prefix = bars.slice(0, i + 1);
    const bar = bars[i]!;

    if (open) {
      const risk = open.entry - open.stopLoss;
      const hitSl = bar.low <= open.stopLoss;
      const hitTp = bar.high >= open.takeProfit;
      if (hitSl || hitTp) {
        let outcome: "win" | "loss" = "win";
        let exit = open.takeProfit;
        if (hitSl && hitTp) {
          outcome = "loss";
          exit = open.stopLoss;
        } else if (hitSl) {
          outcome = "loss";
          exit = open.stopLoss;
        }
        const rMultiple =
          risk > 0 ? (exit - open.entry) / risk : outcome === "win" ? 1 : -1;
        trades.push({
          setupBarTime: open.setupBarTime,
          entryBarTime: open.entryBarTime,
          exitBarTime: bar.timestamp,
          entry: open.entry,
          stopLoss: open.stopLoss,
          takeProfit: open.takeProfit,
          exit,
          riskReward: open.riskReward,
          rMultiple: Number(rMultiple.toFixed(2)),
          outcome,
          obLow: open.obLow,
          obHigh: open.obHigh,
        });
        open = null;
      }
      continue;
    }

    if (pending) {
      if (barTouchesZone(bar, pending.obLow, pending.obHigh)) {
        open = {
          ...pending,
          entryBarTime: bar.timestamp,
          entry: fillInZone(bar, pending.obLow, pending.obHigh),
        };
        pending = null;
      } else if (bar.close < pending.stopLoss) {
        pending = null;
      }
    }

    if (open || pending) continue;

    const { setup } = detectBullishStructure(symbol, prefix, timeframe);
    if (!setup) continue;

    const setupKey = `${setup.setupBarTime}:${setup.obLow.toFixed(5)}:${setup.obHigh.toFixed(5)}`;
    if (seenSetups.has(setupKey)) continue;
    seenSetups.add(setupKey);

    if (setup.phase === "in_zone" && barTouchesZone(bar, setup.obLow, setup.obHigh)) {
      open = {
        setupKey,
        setupBarTime: setup.setupBarTime,
        entryBarTime: bar.timestamp,
        entry: fillInZone(bar, setup.obLow, setup.obHigh),
        stopLoss: setup.stopLoss,
        takeProfit: setup.takeProfit,
        riskReward: setup.riskReward,
        obLow: setup.obLow,
        obHigh: setup.obHigh,
      };
    } else if (setup.phase === "waiting_retrace" || setup.phase === "in_zone") {
      pending = {
        setupKey,
        setupBarTime: setup.setupBarTime,
        stopLoss: setup.stopLoss,
        takeProfit: setup.takeProfit,
        riskReward: setup.riskReward,
        obLow: setup.obLow,
        obHigh: setup.obHigh,
      };
    }
  }

  if (open) {
    trades.push({
      setupBarTime: open.setupBarTime,
      entryBarTime: open.entryBarTime,
      exitBarTime: null,
      entry: open.entry,
      stopLoss: open.stopLoss,
      takeProfit: open.takeProfit,
      exit: null,
      riskReward: open.riskReward,
      rMultiple: null,
      outcome: "open",
      obLow: open.obLow,
      obHigh: open.obHigh,
    });
  }

  const closed = trades.filter((t) => t.outcome !== "open");
  const wins = closed.filter((t) => t.outcome === "win").length;
  const losses = closed.filter((t) => t.outcome === "loss").length;
  const rValues = closed
    .map((t) => t.rMultiple)
    .filter((r): r is number => r != null);
  const totalR = rValues.reduce((sum, r) => sum + r, 0);
  const avgR =
    rValues.length > 0
      ? Number((totalR / rValues.length).toFixed(2))
      : null;
  const winRatePct =
    closed.length > 0
      ? Number(((wins / closed.length) * 100).toFixed(1))
      : null;

  const listed =
    trades.length > maxTradesListed
      ? trades.slice(trades.length - maxTradesListed)
      : trades;

  if (trades.length > maxTradesListed) {
    notes.push(`Showing last ${maxTradesListed} of ${trades.length} trades.`);
  }

  return {
    symbol: symbol.toUpperCase(),
    timeframe,
    barCount: bars.length,
    tradeCount: trades.length,
    wins,
    losses,
    openTrades: trades.filter((t) => t.outcome === "open").length,
    winRatePct,
    avgR,
    totalR: Number(totalR.toFixed(2)),
    trades: listed,
    notes,
  };
}
