import { mapPool } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import {
  buildMarketSnapshot,
  fetchCompanyNews,
  fetchDailyOhlc,
  fetchNewsSentiment,
} from "@/lib/market";
import { defaultExchangeForSymbol, isCryptoPair, resolveSymbolInput } from "@/lib/symbols";
import {
  getPaperCash,
  getPaperPositions,
  savePaperPositions,
  setPaperCash,
} from "@/lib/redis";
import type {
  PaperPosition,
  PaperPositionMark,
  PortfolioSummary,
} from "@/types";

function createId(): string {
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function markPriceFor(symbol: string): Promise<number> {
  const series = await fetchDailyOhlc(symbol);
  if (!series.bars.length) {
    throw new Error(`No price data for ${symbol}`);
  }
  return series.bars[series.bars.length - 1].close;
}

function toMark(
  position: PaperPosition,
  markPrice: number,
): PaperPositionMark {
  const qty = position.quantity;
  const costBasis = position.entryPrice * qty;
  const marketValue =
    (position.status === "closed" && position.exitPrice != null
      ? position.exitPrice
      : markPrice) * qty;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPnlPct =
    costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;

  return {
    ...position,
    markPrice:
      position.status === "closed" && position.exitPrice != null
        ? position.exitPrice
        : markPrice,
    marketValue,
    costBasis,
    unrealizedPnl,
    unrealizedPnlPct,
  };
}

export async function paperBuy(params: {
  userId: string;
  symbol: string;
  quantity: number;
  exchange?: string;
  entryPrice?: number;
  notes?: string;
}): Promise<PaperPositionMark & { cashRemaining: number }> {
  const resolved = resolveSymbolInput(params.symbol);
  const symbol = resolved.symbol;
  if (!symbol) {
    throw new Error("Symbol is required");
  }
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }

  const entryPrice =
    params.entryPrice != null && Number.isFinite(params.entryPrice)
      ? params.entryPrice
      : await markPriceFor(symbol);

  if (entryPrice <= 0) {
    throw new Error("Entry price must be positive");
  }

  const cost = entryPrice * params.quantity;
  const cash = await getPaperCash(params.userId);
  if (cost > cash) {
    throw new Error(
      `Insufficient paper cash: need $${cost.toFixed(2)}, have $${cash.toFixed(2)}`,
    );
  }

  const position: PaperPosition = {
    id: createId(),
    symbol,
    exchange: (
      params.exchange ??
      resolved.exchange ??
      defaultExchangeForSymbol(symbol)
    ).toUpperCase(),
    side: "long",
    quantity: params.quantity,
    entryPrice,
    entryAt: new Date().toISOString(),
    status: "open",
    notes: params.notes,
  };

  const existing = await getPaperPositions(params.userId);
  await savePaperPositions(params.userId, [...existing, position]);
  const cashRemaining = cash - cost;
  await setPaperCash(params.userId, cashRemaining);

  return { ...toMark(position, entryPrice), cashRemaining };
}

export async function paperSell(params: {
  userId: string;
  symbol?: string;
  positionId?: string;
  exitPrice?: number;
}): Promise<PaperPositionMark & { cashRemaining: number }> {
  const positions = await getPaperPositions(params.userId);
  const open = positions.filter((p) => p.status === "open");

  let target: PaperPosition | undefined;
  if (params.positionId) {
    target = open.find((p) => p.id === params.positionId);
  } else if (params.symbol) {
    const want = resolveSymbolInput(params.symbol).symbol;
    target = [...open]
      .reverse()
      .find(
        (p) =>
          p.symbol === want ||
          p.symbol.replaceAll("/", "") === want.replaceAll("/", ""),
      );
  }

  if (!target) {
    throw new Error("No open paper position found to sell");
  }

  const exitPrice =
    params.exitPrice != null && Number.isFinite(params.exitPrice)
      ? params.exitPrice
      : await markPriceFor(target.symbol);

  const proceeds = exitPrice * target.quantity;
  const cash = await getPaperCash(params.userId);
  const cashRemaining = cash + proceeds;
  await setPaperCash(params.userId, cashRemaining);

  const closed: PaperPosition = {
    ...target,
    status: "closed",
    exitPrice,
    exitAt: new Date().toISOString(),
  };

  const next = positions.map((p) => (p.id === closed.id ? closed : p));
  await savePaperPositions(params.userId, next);
  return { ...toMark(closed, exitPrice), cashRemaining };
}

export async function getPortfolioSummary(
  userId: string,
): Promise<PortfolioSummary> {
  const positions = await getPaperPositions(userId);
  const open = positions.filter((p) => p.status === "open");
  const cash = await getPaperCash(userId);

  const marks = await mapPool(open, 4, async (position) => {
    try {
      const mark = await markPriceFor(position.symbol);
      return toMark(position, mark);
    } catch (error) {
      logger.error("paper", "mark failed", {
        symbol: position.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return toMark(position, position.entryPrice);
    }
  });

  const totalCost = marks.reduce((sum, m) => sum + m.costBasis, 0);
  const totalMarketValue = marks.reduce((sum, m) => sum + m.marketValue, 0);
  const totalUnrealizedPnl = totalMarketValue - totalCost;
  const totalUnrealizedPnlPct =
    totalCost === 0 ? 0 : (totalUnrealizedPnl / totalCost) * 100;
  const equity = cash + totalMarketValue;

  return {
    positions: marks,
    openCount: marks.length,
    cash,
    totalCost,
    totalMarketValue,
    equity,
    totalUnrealizedPnl,
    totalUnrealizedPnlPct,
  };
}

/** Full snapshot with sentiment + recent headlines (equities). Crypto skips Finnhub news. */
export async function loadSnapshot(symbol: string, exchange = "NASDAQ") {
  const crypto = isCryptoPair(symbol);
  const [series, sentiment, headlines] = await Promise.all([
    fetchDailyOhlc(symbol),
    crypto ? Promise.resolve(null) : fetchNewsSentiment(symbol),
    crypto ? Promise.resolve([]) : fetchCompanyNews(symbol, 3, 3),
  ]);
  return buildMarketSnapshot(
    series,
    crypto ? "CRYPTO" : exchange,
    sentiment,
    headlines,
  );
}
