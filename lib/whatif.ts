import { fetchDailyOhlc } from "@/lib/market";
import { resolveSymbolInput } from "@/lib/symbols";
import type { OhlcBar, WhatIfResult } from "@/types";

function parseDay(input: string): Date {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return d;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function findBarOnOrAfter(bars: OhlcBar[], dayMs: number): OhlcBar | null {
  for (const bar of bars) {
    const barDay = startOfUtcDay(new Date(bar.timestamp * 1000));
    if (barDay >= dayMs) {
      return bar;
    }
  }
  return null;
}

function findBarOnOrBefore(bars: OhlcBar[], dayMs: number): OhlcBar | null {
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const bar = bars[i];
    const barDay = startOfUtcDay(new Date(bar.timestamp * 1000));
    if (barDay <= dayMs) {
      return bar;
    }
  }
  return null;
}

/**
 * Counterfactual PnL from historical OHLC — pure TypeScript, no invented prices.
 */
export async function computeWhatIf(params: {
  symbol: string;
  entryDate: string;
  exitDate?: string;
  quantity?: number;
  entryPrice?: number;
}): Promise<WhatIfResult> {
  const symbol = resolveSymbolInput(params.symbol).symbol;
  if (!symbol) {
    throw new Error("Symbol is required");
  }

  const quantity =
    params.quantity != null && Number.isFinite(params.quantity)
      ? params.quantity
      : 1;
  if (quantity <= 0) {
    throw new Error("Quantity must be positive");
  }

  const entryDay = startOfUtcDay(parseDay(params.entryDate));
  const exitDay = startOfUtcDay(
    params.exitDate ? parseDay(params.exitDate) : new Date(),
  );

  if (exitDay < entryDay) {
    throw new Error("Exit date must be on or after entry date");
  }

  const lookbackDays = Math.max(
    40,
    Math.ceil((Date.now() - entryDay) / (1000 * 60 * 60 * 24)) + 5,
  );
  const series = await fetchDailyOhlc(symbol, lookbackDays);
  if (!series.bars.length) {
    throw new Error(`No OHLC data for ${symbol}`);
  }

  const entryBar = findBarOnOrAfter(series.bars, entryDay);
  const exitBar = findBarOnOrBefore(series.bars, exitDay);

  if (!entryBar) {
    throw new Error(`No trading bar on/after ${params.entryDate} for ${symbol}`);
  }
  if (!exitBar) {
    throw new Error(`No trading bar on/before exit date for ${symbol}`);
  }

  const entryPrice =
    params.entryPrice != null && Number.isFinite(params.entryPrice)
      ? params.entryPrice
      : entryBar.open;
  const exitPrice = exitBar.close;

  const costBasis = entryPrice * quantity;
  const marketValue = exitPrice * quantity;
  const pnl = marketValue - costBasis;
  const pnlPct = costBasis === 0 ? 0 : (pnl / costBasis) * 100;

  return {
    symbol,
    entryDate: new Date(entryBar.timestamp * 1000).toISOString().slice(0, 10),
    exitDate: new Date(exitBar.timestamp * 1000).toISOString().slice(0, 10),
    entryPrice,
    exitPrice,
    quantity,
    costBasis,
    marketValue,
    pnl,
    pnlPct,
    barsUsed: series.bars.length,
  };
}
