import { tool } from "ai";
import { z } from "zod";

import { verifyTradableSymbol } from "@/lib/market";
import {
  getPortfolioSummary,
  loadSnapshot,
  paperBuy,
  paperSell,
} from "@/lib/paper";
import { recommendFromWatchlist } from "@/lib/recommend";
import {
  addToUserWatchlist,
  getUserWatchlist,
  removeFromUserWatchlist,
} from "@/lib/redis";
import { computeWhatIf } from "@/lib/whatif";

function slimSnapshot(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  return {
    symbol: snapshot.symbol,
    exchange: snapshot.exchange,
    currentPrice: snapshot.currentPrice,
    changePct: Number(snapshot.changePct.toFixed(2)),
    sma14: Number(snapshot.sma14.toFixed(2)),
    pctBelowSma14: Number(snapshot.pctBelowSma14.toFixed(2)),
    volumeRatio: Number(snapshot.volumeRatio.toFixed(2)),
    volume: snapshot.volume,
    sentimentScore: snapshot.sentimentScore,
    recentCloses: snapshot.closes.slice(-10).map((v) => Number(v.toFixed(2))),
    headlines: (snapshot.headlines ?? []).map((h) => ({
      headline: h.headline,
      summary: h.summary?.slice(0, 280) || null,
      source: h.source,
      url: h.url || null,
      datetime: h.datetime,
    })),
  };
}

export function createDeskTools(userId: string) {
  return {
    getSnapshot: tool({
      description:
        "Fetch a live market snapshot for a symbol (price, SMA, volume ratio, sentiment, recent headlines with short summaries). After calling, explain headlines in plain English — do not only list titles.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. NVDA"),
        exchange: z
          .string()
          .optional()
          .describe("Exchange label, default NASDAQ"),
      }),
      execute: async ({ symbol, exchange }) => {
        const snapshot = await loadSnapshot(symbol, exchange ?? "NASDAQ");
        return slimSnapshot(snapshot);
      },
    }),

    listWatchlist: tool({
      description: "List symbols the user is monitoring.",
      inputSchema: z.object({}),
      execute: async () => {
        const watchlist = await getUserWatchlist(userId);
        return { watchlist };
      },
    }),

    monitorSymbol: tool({
      description:
        "Add a symbol to the user's watchlist after verifying market data. Do not claim it was added if verification fails.",
      inputSchema: z.object({
        symbol: z.string(),
        exchange: z.string().optional(),
      }),
      execute: async ({ symbol, exchange }) => {
        try {
          const verified = await verifyTradableSymbol(symbol);
          const watchlist = await addToUserWatchlist(
            userId,
            verified,
            exchange ?? "NASDAQ",
          );
          return { ok: true, watchlist };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not verify symbol — not added",
          };
        }
      },
    }),

    unmonitorSymbol: tool({
      description:
        "Remove a symbol from the user's watchlist. Cron drops it only if no other user still watches it.",
      inputSchema: z.object({
        symbol: z.string(),
      }),
      execute: async ({ symbol }) => {
        const watchlist = await removeFromUserWatchlist(userId, symbol);
        return { ok: true, watchlist };
      },
    }),

    recommend: tool({
      description:
        "Rank the user's watchlist for dip/breakout signals. Returns empty if watchlist is empty — never invents a universe.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ limit }) => {
        const watchlist = await getUserWatchlist(userId);
        if (watchlist.length === 0) {
          return {
            count: 0,
            recommendations: [],
            message:
              "Watchlist is empty. Ask me to monitor a ticker first, then recommend.",
          };
        }
        const recommendations = await recommendFromWatchlist(
          watchlist,
          limit ?? 5,
        );
        return {
          count: recommendations.length,
          recommendations: recommendations.map((r) => ({
            symbol: r.symbol,
            exchange: r.exchange,
            type: r.type,
            score: Number(r.score.toFixed(2)),
            reason: r.reason,
            currentPrice: r.snapshot.currentPrice,
            changePct: Number(r.snapshot.changePct.toFixed(2)),
            volumeRatio: Number(r.snapshot.volumeRatio.toFixed(2)),
            headline: r.snapshot.headlines?.[0]?.headline ?? null,
          })),
        };
      },
    }),

    paperBuy: tool({
      description:
        "Open a paper long using paper cash ($100k starting balance). Fails if cash is insufficient.",
      inputSchema: z.object({
        symbol: z.string(),
        quantity: z.number().positive(),
        exchange: z.string().optional(),
        entryPrice: z.number().positive().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        const position = await paperBuy({ userId, ...input });
        return {
          id: position.id,
          symbol: position.symbol,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          markPrice: position.markPrice,
          unrealizedPnl: Number(position.unrealizedPnl.toFixed(2)),
          cashRemaining: Number(position.cashRemaining.toFixed(2)),
        };
      },
    }),

    paperSell: tool({
      description: "Close an open paper position; proceeds return to paper cash.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        positionId: z.string().optional(),
        exitPrice: z.number().positive().optional(),
      }),
      execute: async (input) => {
        const position = await paperSell({ userId, ...input });
        return {
          id: position.id,
          symbol: position.symbol,
          exitPrice: position.exitPrice,
          unrealizedPnl: Number(position.unrealizedPnl.toFixed(2)),
          unrealizedPnlPct: Number(position.unrealizedPnlPct.toFixed(2)),
          cashRemaining: Number(position.cashRemaining.toFixed(2)),
        };
      },
    }),

    portfolioPnL: tool({
      description:
        "Mark-to-market summary of open paper positions plus remaining cash and equity.",
      inputSchema: z.object({}),
      execute: async () => {
        const summary = await getPortfolioSummary(userId);
        return {
          openCount: summary.openCount,
          cash: Number(summary.cash.toFixed(2)),
          equity: Number(summary.equity.toFixed(2)),
          totalCost: Number(summary.totalCost.toFixed(2)),
          totalMarketValue: Number(summary.totalMarketValue.toFixed(2)),
          totalUnrealizedPnl: Number(summary.totalUnrealizedPnl.toFixed(2)),
          totalUnrealizedPnlPct: Number(
            summary.totalUnrealizedPnlPct.toFixed(2),
          ),
          positions: summary.positions.map((p) => ({
            id: p.id,
            symbol: p.symbol,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            markPrice: p.markPrice,
            unrealizedPnl: Number(p.unrealizedPnl.toFixed(2)),
            unrealizedPnlPct: Number(p.unrealizedPnlPct.toFixed(2)),
          })),
        };
      },
    }),

    whatIf: tool({
      description:
        "Counterfactual: if we bought SYMBOL on entryDate (optional qty/price), what would PnL be through exitDate (default today)? Uses real OHLC bars only.",
      inputSchema: z.object({
        symbol: z.string(),
        entryDate: z
          .string()
          .describe("ISO date YYYY-MM-DD for the hypothetical buy"),
        exitDate: z.string().optional(),
        quantity: z.number().positive().optional(),
        entryPrice: z.number().positive().optional(),
      }),
      execute: async (input) => {
        const result = await computeWhatIf(input);
        return {
          ...result,
          entryPrice: Number(result.entryPrice.toFixed(4)),
          exitPrice: Number(result.exitPrice.toFixed(4)),
          costBasis: Number(result.costBasis.toFixed(2)),
          marketValue: Number(result.marketValue.toFixed(2)),
          pnl: Number(result.pnl.toFixed(2)),
          pnlPct: Number(result.pnlPct.toFixed(2)),
        };
      },
    }),
  };
}
