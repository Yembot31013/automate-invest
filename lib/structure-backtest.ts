import { logger } from "@/lib/logger";
import {
  backtestBullishStructure,
  type StructureBacktestResult,
} from "@/lib/structure/backtest";
import {
  fetchForexStructureBars,
  normalizeStructureTimeframe,
  type StructureTimeframe,
} from "@/lib/structure/timeframes";
import { isForexPair, resolveSymbolInput } from "@/lib/symbols";

export type StructureBacktestRun = StructureBacktestResult & {
  ok: true;
};

export type StructureBacktestFailure = {
  ok: false;
  error: string;
};

/** Fetch FX structure bars and run the deterministic BOS+FVG+OB backtest. */
export async function runStructureBacktest(params: {
  symbol: string;
  timeframe?: string | null;
}): Promise<StructureBacktestRun | StructureBacktestFailure> {
  const resolved = resolveSymbolInput(params.symbol);
  if (!resolved.symbol || !isForexPair(resolved.symbol)) {
    return {
      ok: false,
      error: `Structure backtest is forex-only. ${resolved.symbol || params.symbol} is not a supported FX pair.`,
    };
  }

  const timeframe: StructureTimeframe = normalizeStructureTimeframe(
    params.timeframe,
  );

  try {
    const bars = await fetchForexStructureBars(resolved.symbol, timeframe);
    const result = backtestBullishStructure({
      symbol: resolved.symbol,
      timeframe,
      bars,
    });
    return { ok: true, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Structure backtest failed";
    logger.warn("structure-backtest", message, {
      symbol: resolved.symbol,
      timeframe,
    });
    return { ok: false, error: message };
  }
}

export function formatStructureBacktestSummary(
  result: StructureBacktestResult,
): string {
  const closed = result.wins + result.losses;
  const winBit =
    result.winRatePct != null
      ? `win rate ${result.winRatePct}% (${result.wins}W / ${result.losses}L)`
      : "no closed trades";
  const rBit =
    result.avgR != null
      ? `avg R ${result.avgR >= 0 ? "+" : ""}${result.avgR} · total R ${result.totalR >= 0 ? "+" : ""}${result.totalR}`
      : "no R stats yet";
  return [
    `${result.symbol} ${result.timeframe} structure backtest · ${result.barCount} bars · ${result.tradeCount} trades`,
    `${winBit} · ${rBit}`,
    result.openTrades > 0 ? `${result.openTrades} still open at end of window` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
