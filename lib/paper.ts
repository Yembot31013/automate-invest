import { mapPool } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import {
  buildMarketSnapshot,
  fetchDailyOhlc,
  fetchHeadlinesForSymbol,
  fetchNewsSentiment,
  toPaperUsdPrice,
} from "@/lib/market";
import {
  defaultExchangeForSymbol,
  isCryptoPair,
  isNgxExchange,
  listSupportedCryptoPairs,
  resolveSymbolInput,
} from "@/lib/symbols";
import { selectOpenPositionsToSell } from "@/lib/paper-select";
import {
  getPaperCash,
  getPaperPositions,
  savePaperPositions,
  setPaperCash,
  withUserPaperLock,
} from "@/lib/redis";
import type {
  PaperPosition,
  PaperPositionMark,
  PortfolioSummary,
} from "@/types";

function createId(): string {
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function markPriceFor(symbol: string, exchange?: string): Promise<number> {
  const resolved = resolveSymbolInput(symbol, exchange);
  const series = await fetchDailyOhlc(resolved.symbol, undefined, resolved.exchange);
  if (!series.bars.length) {
    throw new Error(`No price data for ${resolved.symbol}`);
  }
  const native = series.bars[series.bars.length - 1].close;
  const venue =
    exchange ?? resolved.exchange ?? defaultExchangeForSymbol(resolved.symbol);
  return toPaperUsdPrice(native, venue);
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
  return withUserPaperLock(params.userId, async () => {
    const resolved = resolveSymbolInput(params.symbol);
    if (resolved.unsupportedCrypto) {
      throw new Error(
        `Unsupported crypto ${resolved.symbol}. Supported: ${listSupportedCryptoPairs().join(", ")}`,
      );
    }
    if (resolved.assetClass === "forex" || resolved.assetClass === "commodity") {
      throw new Error(
        `Paper trading is not enabled for ${resolved.symbol} yet — snapshots only for FX and commodities.`,
      );
    }
    const symbol = resolved.symbol;
    if (!symbol) {
      throw new Error("Symbol is required");
    }
    if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
      throw new Error("Quantity must be a positive number");
    }

    const exchange = (
      params.exchange ??
      resolved.exchange ??
      defaultExchangeForSymbol(symbol)
    ).toUpperCase();

    const entryPrice =
      params.entryPrice != null && Number.isFinite(params.entryPrice)
        ? await toPaperUsdPrice(params.entryPrice, exchange)
        : await markPriceFor(symbol, exchange);

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
      exchange,
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
  }).then(async (result) => {
    const { syncTriggersWithPaperBook } = await import("@/lib/trigger-sync");
    await syncTriggersWithPaperBook(params.userId);
    return result;
  });
}

export async function paperSell(params: {
  userId: string;
  symbol?: string;
  positionId?: string;
  exitPrice?: number;
}): Promise<PaperPositionMark & { cashRemaining: number }> {
  return withUserPaperLock(params.userId, async () => {
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
        ? await toPaperUsdPrice(params.exitPrice, target.exchange)
        : await markPriceFor(target.symbol, target.exchange);

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
  }).then(async (result) => {
    const { syncTriggersWithPaperBook } = await import("@/lib/trigger-sync");
    await syncTriggersWithPaperBook(params.userId);
    return result;
  });
}

/**
 * Close many (or all) open paper positions in one atomic book update.
 * Prefer this for “sell all” / multi-ticker exits — parallel paperSell races without the lock.
 */
export async function paperSellMany(params: {
  userId: string;
  sellAll?: boolean;
  symbols?: string[];
}): Promise<{
  ok: boolean;
  closedCount: number;
  closed: Array<{
    id: string;
    symbol: string;
    quantity: number;
    exitPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  }>;
  cashRemaining: number;
  remainingOpen: number;
  message?: string;
}> {
  return withUserPaperLock(params.userId, async () => {
    const positions = await getPaperPositions(params.userId);
    const open = positions.filter((p) => p.status === "open");

    if (!params.sellAll && !(params.symbols && params.symbols.length > 0)) {
      throw new Error(
        "paperSellMany needs sellAll: true or a non-empty symbols list",
      );
    }

    const targets = selectOpenPositionsToSell(open, {
      sellAll: params.sellAll,
      symbols: params.symbols,
    });

    if (targets.length === 0) {
      const cash = await getPaperCash(params.userId);
      return {
        ok: true,
        closedCount: 0,
        closed: [],
        cashRemaining: Number(cash.toFixed(2)),
        remainingOpen: open.length,
        message: params.sellAll
          ? "No open paper positions to sell"
          : "None of those symbols had an open paper position",
      };
    }

    const exitAt = new Date().toISOString();
    const closedMarks: PaperPositionMark[] = [];
    const closedById = new Map<string, PaperPosition>();

    for (const target of targets) {
      const exitPrice = await markPriceFor(target.symbol, target.exchange);
      const closed: PaperPosition = {
        ...target,
        status: "closed",
        exitPrice,
        exitAt,
      };
      closedById.set(closed.id, closed);
      closedMarks.push(toMark(closed, exitPrice));
    }

    const proceeds = closedMarks.reduce((sum, m) => sum + m.marketValue, 0);
    const cash = await getPaperCash(params.userId);
    const cashRemaining = cash + proceeds;

    const next = positions.map((p) => closedById.get(p.id) ?? p);
    await savePaperPositions(params.userId, next);
    await setPaperCash(params.userId, cashRemaining);

    const remainingOpen = next.filter((p) => p.status === "open").length;

    return {
      ok: true,
      closedCount: closedMarks.length,
      closed: closedMarks.map((m) => ({
        id: m.id,
        symbol: m.symbol,
        quantity: m.quantity,
        exitPrice: m.exitPrice ?? m.markPrice,
        unrealizedPnl: Number(m.unrealizedPnl.toFixed(2)),
        unrealizedPnlPct: Number(m.unrealizedPnlPct.toFixed(2)),
      })),
      cashRemaining: Number(cashRemaining.toFixed(2)),
      remainingOpen,
    };
  }).then(async (result) => {
    const { syncTriggersWithPaperBook } = await import("@/lib/trigger-sync");
    await syncTriggersWithPaperBook(params.userId);
    return result;
  });
}

export type PaperSellClose =
  | { mode: "all" }
  | { mode: "pct"; pct: number }
  | { mode: "usd"; usd: number };

function findNewestOpenLot(
  open: PaperPosition[],
  symbol: string,
): PaperPosition | undefined {
  const want = resolveSymbolInput(symbol).symbol;
  return [...open]
    .reverse()
    .find(
      (p) =>
        p.symbol === want ||
        p.symbol.replaceAll("/", "") === want.replaceAll("/", ""),
    );
}

/**
 * Close a symbol for triggers — all lots, or a partial slice of the newest lot.
 */
export async function paperSellSymbol(params: {
  userId: string;
  symbol: string;
  close: PaperSellClose;
}): Promise<{
  ok: boolean;
  closedCount: number;
  closedQty: number;
  remainingQty: number;
  partial: boolean;
  closed: Array<{
    id: string;
    symbol: string;
    quantity: number;
    exitPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  }>;
  cashRemaining: number;
  remainingOpen: number;
  message?: string;
}> {
  if (params.close.mode === "all") {
    const sold = await paperSellMany({
      userId: params.userId,
      symbols: [params.symbol],
    });
    const closedQty = sold.closed.reduce((sum, c) => sum + c.quantity, 0);
    return {
      ok: sold.ok,
      closedCount: sold.closedCount,
      closedQty,
      remainingQty: 0,
      partial: false,
      closed: sold.closed,
      cashRemaining: sold.cashRemaining,
      remainingOpen: sold.remainingOpen,
      message: sold.message,
    };
  }

  return withUserPaperLock(params.userId, async () => {
    const positions = await getPaperPositions(params.userId);
    const open = positions.filter((p) => p.status === "open");
    const target = findNewestOpenLot(open, params.symbol);

    if (!target) {
      const cash = await getPaperCash(params.userId);
      return {
        ok: true,
        closedCount: 0,
        closedQty: 0,
        remainingQty: 0,
        partial: false,
        closed: [],
        cashRemaining: Number(cash.toFixed(2)),
        remainingOpen: open.length,
        message: "No open paper position found to sell",
      };
    }

    const exitPrice = await markPriceFor(target.symbol, target.exchange);
    let sellQty: number;
    if (params.close.mode === "pct") {
      sellQty = (target.quantity * params.close.pct) / 100;
    } else if (params.close.mode === "usd") {
      sellQty = params.close.usd / exitPrice;
    } else {
      throw new Error("Partial sell requires pct or usd mode");
    }
    sellQty = Math.min(target.quantity, sellQty);
    if (!Number.isFinite(sellQty) || sellQty <= 0) {
      throw new Error("Partial sell size must be positive");
    }

    const fullClose = sellQty >= target.quantity * 0.999999;
    const cash = await getPaperCash(params.userId);
    const exitAt = new Date().toISOString();

    if (fullClose) {
      const proceeds = exitPrice * target.quantity;
      const cashRemaining = cash + proceeds;
      const closed: PaperPosition = {
        ...target,
        status: "closed",
        exitPrice,
        exitAt,
      };
      const next = positions.map((p) => (p.id === closed.id ? closed : p));
      await savePaperPositions(params.userId, next);
      await setPaperCash(params.userId, cashRemaining);
      const mark = toMark(closed, exitPrice);
      const remainingOpen = next.filter((p) => p.status === "open").length;
      return {
        ok: true,
        closedCount: 1,
        closedQty: target.quantity,
        remainingQty: 0,
        partial: false,
        closed: [
          {
            id: mark.id,
            symbol: mark.symbol,
            quantity: mark.quantity,
            exitPrice: mark.exitPrice ?? mark.markPrice,
            unrealizedPnl: Number(mark.unrealizedPnl.toFixed(2)),
            unrealizedPnlPct: Number(mark.unrealizedPnlPct.toFixed(2)),
          },
        ],
        cashRemaining: Number(cashRemaining.toFixed(2)),
        remainingOpen,
      };
    }

    const proceeds = exitPrice * sellQty;
    const cashRemaining = cash + proceeds;
    const remainderQty = target.quantity - sellQty;

    const closedSlice: PaperPosition = {
      ...target,
      id: createId(),
      quantity: sellQty,
      status: "closed",
      exitPrice,
      exitAt,
      notes: target.notes
        ? `${target.notes} · partial sell`
        : "partial sell",
    };
    const remainder: PaperPosition = {
      ...target,
      quantity: remainderQty,
    };

    const next = positions
      .filter((p) => p.id !== target.id)
      .concat([remainder, closedSlice]);
    await savePaperPositions(params.userId, next);
    await setPaperCash(params.userId, cashRemaining);

    const mark = toMark(closedSlice, exitPrice);
    const remainingOpen = next.filter((p) => p.status === "open").length;

    return {
      ok: true,
      closedCount: 1,
      closedQty: sellQty,
      remainingQty: remainderQty,
      partial: true,
      closed: [
        {
          id: mark.id,
          symbol: mark.symbol,
          quantity: mark.quantity,
          exitPrice: mark.exitPrice ?? mark.markPrice,
          unrealizedPnl: Number(mark.unrealizedPnl.toFixed(2)),
          unrealizedPnlPct: Number(mark.unrealizedPnlPct.toFixed(2)),
        },
      ],
      cashRemaining: Number(cashRemaining.toFixed(2)),
      remainingOpen,
    };
  }).then(async (result) => {
    const { syncTriggersWithPaperBook } = await import("@/lib/trigger-sync");
    await syncTriggersWithPaperBook(params.userId);
    return result;
  });
}

export async function getPortfolioSummary(
  userId: string,
): Promise<PortfolioSummary> {
  const positions = await getPaperPositions(userId);
  const open = positions.filter((p) => p.status === "open");
  const cash = await getPaperCash(userId);

  const marks = await mapPool(open, 4, async (position) => {
    try {
      const mark = await markPriceFor(position.symbol, position.exchange);
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

/** Full snapshot — equities use company-news; crypto uses Finnhub crypto; macro uses forex feed; NGX uses NGN Market. */
export async function loadSnapshot(symbol: string, exchange = "NASDAQ") {
  const resolved = resolveSymbolInput(symbol, exchange);
  const crypto = isCryptoPair(resolved.symbol);
  const ngx = isNgxExchange(exchange) || isNgxExchange(resolved.exchange);
  const macro =
    resolved.assetClass === "forex" || resolved.assetClass === "commodity";
  const venue = crypto
    ? "CRYPTO"
    : ngx
      ? "NGX"
      : macro
        ? resolved.exchange
        : exchange;
  const [series, sentiment, headlines] = await Promise.all([
    fetchDailyOhlc(resolved.symbol, undefined, venue),
    crypto || ngx || macro
      ? Promise.resolve(null)
      : fetchNewsSentiment(resolved.symbol),
    fetchHeadlinesForSymbol(resolved.symbol, 3, venue),
  ]);
  return buildMarketSnapshot(series, venue, sentiment, headlines);
}
