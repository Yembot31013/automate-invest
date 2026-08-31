import { tool } from "ai";
import { z } from "zod";

import { verifyTradableSymbolDetailed } from "@/lib/market";
import {
  convertForeignToNgn,
  convertNgnToForeign,
  fetchNgxForexQuote,
  hasNgnMarketCredentials,
  NgnMarketError,
} from "@/lib/ngnmarket";
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
import { sendCapabilityGapEmail } from "@/lib/email/resend";
import { MAX_USER_WATCHLIST } from "@/lib/limits";
import {
  findWatchlistSymbol,
  resolveSymbolInput,
} from "@/lib/symbols";
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
        "Fetch a live market snapshot for a symbol (price, SMA, volume ratio, sentiment, recent headlines with short summaries). Supports US/NGX equities, allowlisted crypto, major FX pairs (EUR/USD, GBP/USD, …), and commodities (XAU/USD gold, XAG/USD silver, WTI/USD oil). After calling, explain headlines in plain English — do not only list titles. For NGX naira→dollar value questions, also call lookupForex.",
      inputSchema: z.object({
        symbol: z
          .string()
          .describe(
            "Ticker or pair, e.g. NVDA, DANGCEM, XAU/USD, xauusd, EUR/USD, BTC/USD",
          ),
        exchange: z
          .string()
          .optional()
          .describe("Exchange label, default NASDAQ (use NGX for Nigerian names)"),
      }),
      execute: async ({ symbol, exchange }) => {
        const resolved = resolveSymbolInput(symbol, exchange);
        const snapshot = await loadSnapshot(
          resolved.symbol,
          exchange ?? resolved.exchange,
        );
        return slimSnapshot(snapshot);
      },
    }),

    lookupForex: tool({
      description:
        "Live NGN Market forex (Free plan). Use for USD/NGN and other NGN crosses, and to convert NGX naira prices or notionals into dollars (or the reverse). Call this whenever the user asks dollar value of an NGX quote, naira per dollar, or FX conversion — do not invent rates and do not reportCapabilityGap for this.",
      inputSchema: z.object({
        currency: z
          .string()
          .optional()
          .describe("Foreign currency vs NGN, default USD (also EUR, GBP, …)"),
        amountNgn: z
          .number()
          .positive()
          .optional()
          .describe("Naira amount to convert into the foreign currency"),
        amountForeign: z
          .number()
          .positive()
          .optional()
          .describe("Foreign amount to convert into naira"),
      }),
      execute: async ({ currency, amountNgn, amountForeign }) => {
        if (!hasNgnMarketCredentials()) {
          return {
            ok: false,
            error:
              "NGNMARKET_API_KEY is not configured — cannot look up live NGN forex.",
          };
        }
        try {
          const code = currency?.trim().toUpperCase() || "USD";
          const quote = await fetchNgxForexQuote(code);
          const result: Record<string, unknown> = {
            ok: true,
            currency: quote.currency,
            pair: `${quote.currency}/NGN`,
            ngnPerUnit: Number(quote.ngnPerUnit.toFixed(4)),
            unitPerNgn: Number(quote.unitPerNgn.toFixed(8)),
            asOf: quote.asOf,
            dailyChangePercent: quote.dailyChangePercent,
            note:
              `₦${quote.ngnPerUnit.toFixed(2)} per 1 ${quote.currency}; ` +
              `1 NGN ≈ ${quote.unitPerNgn.toFixed(6)} ${quote.currency}. ` +
              "Same rate family used when paper-trading NGX names into the USD paper book.",
          };

          if (amountNgn != null) {
            const converted = await convertNgnToForeign(amountNgn, code);
            result.amountNgn = amountNgn;
            result.convertedForeign = Number(converted.amount.toFixed(6));
            result.convertedLabel = `${amountNgn} NGN ≈ ${converted.amount.toFixed(4)} ${code}`;
          }
          if (amountForeign != null) {
            const converted = await convertForeignToNgn(amountForeign, code);
            result.amountForeign = amountForeign;
            result.convertedNgn = Number(converted.amountNgn.toFixed(2));
            result.convertedLabelNgn = `${amountForeign} ${code} ≈ ₦${converted.amountNgn.toFixed(2)}`;
          }

          return result;
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof NgnMarketError || error instanceof Error
                ? error.message
                : "Forex lookup failed",
          };
        }
      },
    }),

    listWatchlist: tool({
      description:
        "List symbols currently on the user's watchlist. Use when they ask what you're watching, or before claiming something is still monitored. Chat history is not enough.",
      inputSchema: z.object({}),
      execute: async () => {
        const watchlist = await getUserWatchlist(userId);
        return {
          watchlist,
          symbols: watchlist.map((entry) => entry.symbol),
        };
      },
    }),

    monitorSymbol: tool({
      description:
        "Add one ticker to the user's watchlist after verifying market data. Equities are open-ended (US + NGX Nigeria); crypto is allowlist-only; major FX and commodities (XAU/USD, EUR/USD, etc.) are supported too. For Nigerian names use e.g. DANGCEM, GTCO, NGX:ACCESS, or 'dangote cement'. Watchlist max is " +
        String(MAX_USER_WATCHLIST) +
        ". Always call when the user asks to monitor. Returns alreadyWatched / assetClass / exchange.",
      inputSchema: z.object({
        symbol: z
          .string()
          .describe(
            "Ticker or name, e.g. AAPL, bitcoin, DANGCEM, dangote cement, NGX:GTCO",
          ),
        exchange: z.string().optional(),
      }),
      execute: async ({ symbol, exchange }) => {
        try {
          const verified = await verifyTradableSymbolDetailed(symbol, exchange);
          const before = await getUserWatchlist(userId);
          const alreadyWatched = before.some(
            (entry) => entry.symbol === verified.symbol,
          );
          const watchlist = await addToUserWatchlist(
            userId,
            verified.symbol,
            exchange ?? verified.exchange,
          );
          return {
            ok: true,
            symbol: verified.symbol,
            exchange: verified.exchange,
            alreadyWatched,
            assetClass:
              verified.exchange === "CRYPTO"
                ? "crypto"
                : verified.exchange === "FOREX" ||
                    verified.exchange === "COMMODITY"
                  ? "forex"
                  : "equity",
            currency: verified.exchange === "NGX" ? "NGN" : "USD",
            watchlist,
          };
        } catch (error) {
          return {
            ok: false,
            symbol: symbol.trim().toUpperCase(),
            error:
              error instanceof Error
                ? error.message
                : "Could not verify symbol — not added",
          };
        }
      },
    }),

    monitorSymbols: tool({
      description:
        "Add multiple tickers to the watchlist in one go (e.g. AMZN and GOOG, or DANGCEM and GTCO). Prefer this when the user lists several symbols. Cap is " +
        String(MAX_USER_WATCHLIST) +
        " total on the list. Reports per-symbol ok/alreadyWatched/error.",
      inputSchema: z.object({
        symbols: z
          .array(z.string())
          .min(1)
          .max(10)
          .describe("Ticker symbols to monitor"),
        exchange: z.string().optional(),
      }),
      execute: async ({ symbols, exchange }) => {
        const before = await getUserWatchlist(userId);
        const beforeSet = new Set(before.map((entry) => entry.symbol));
        const results: Array<{
          symbol: string;
          ok: boolean;
          alreadyWatched?: boolean;
          exchange?: string;
          assetClass?: "crypto" | "equity" | "forex";
          error?: string;
        }> = [];

        for (const raw of symbols) {
          try {
            const verified = await verifyTradableSymbolDetailed(raw, exchange);
            const alreadyWatched = beforeSet.has(verified.symbol);
            await addToUserWatchlist(
              userId,
              verified.symbol,
              exchange ?? verified.exchange,
            );
            beforeSet.add(verified.symbol);
            results.push({
              symbol: verified.symbol,
              ok: true,
              alreadyWatched,
              exchange: verified.exchange,
              assetClass:
                verified.exchange === "CRYPTO"
                  ? "crypto"
                  : verified.exchange === "FOREX" ||
                      verified.exchange === "COMMODITY"
                    ? "forex"
                    : "equity",
            });
          } catch (error) {
            results.push({
              symbol: raw.trim().toUpperCase(),
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not verify symbol — not added",
            });
          }
        }

        const watchlist = await getUserWatchlist(userId);
        return {
          ok: results.every((r) => r.ok),
          results,
          watchlist,
        };
      },
    }),

    unmonitorSymbol: tool({
      description:
        "Remove one ticker from the user's watchlist. Call this for casual asks like 'remove it', 'take that off', 'drop BTC', 'stop watching amazon' — resolve the symbol from context/live watchlist first. Never claim removal without this tool returning removed: true.",
      inputSchema: z.object({
        symbol: z
          .string()
          .describe("Ticker to remove, e.g. BTC, AMZN, GOOG"),
      }),
      execute: async ({ symbol }) => {
        const before = await getUserWatchlist(userId);
        const matched = findWatchlistSymbol(before, symbol);
        if (!matched) {
          const fallback = resolveSymbolInput(symbol).symbol || symbol.trim().toUpperCase();
          return {
            ok: true,
            removed: false,
            symbol: fallback,
            wasPresent: false,
            watchlist: before,
            message: `${fallback} was not on the watchlist`,
          };
        }
        const watchlist = await removeFromUserWatchlist(userId, matched);
        return {
          ok: true,
          removed: true,
          symbol: matched,
          wasPresent: true,
          watchlist,
        };
      },
    }),

    reportCapabilityGap: tool({
      description:
        "Email the product owner a detailed, actionable brief when the user wants something the desk cannot do yet (missing data/API, wrong asset class, plan limit, or unimplemented feature). Use when you must refuse or only partially help. Be specific about what to build.",
      inputSchema: z.object({
        userRequest: z
          .string()
          .describe("What the user asked for, in their words plus your interpretation"),
        gapTitle: z
          .string()
          .describe("Short title, e.g. Spot Bitcoin monitoring (not equity BTC)"),
        whyBlocked: z
          .string()
          .describe("Concrete reason we cannot fulfill this with current tools/data"),
        whatExistsToday: z
          .string()
          .describe("Closest capabilities we already have"),
        whatToBuild: z
          .string()
          .describe(
            "Specific implementation steps so the AI can do this later (APIs, tools, schema, UI)",
          ),
        suggestedToolsApis: z
          .string()
          .optional()
          .describe("Named APIs, endpoints, or packages to add"),
        priority: z.enum(["low", "medium", "high"]).optional(),
        conversationContext: z
          .string()
          .optional()
          .describe("1–3 lines of relevant prior chat context"),
      }),
      execute: async (input) => {
        const result = await sendCapabilityGapEmail({
          userId,
          ...input,
        });
        if (!result.ok) {
          return {
            ok: false,
            emailed: false,
            error: result.error,
            message:
              "Could not email the product owner — tell the user the limit honestly anyway.",
          };
        }
        return {
          ok: true,
          emailed: true,
          emailId: result.id,
          message:
            "Product owner was emailed a detailed capability-gap brief. Tell the user you've flagged it for the team.",
        };
      },
    }),

    recommend: tool({
      description:
        "Rank the user's watchlist ONLY for dip/breakout signals (not the whole market). Returns empty if watchlist is empty or nothing triggers. Never invents tickers outside the list.",
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
          tip: "Paper trading is chat-only: “buy 5 SYMBOL” opens a long; “sell SYMBOL” / “close my SYMBOL” closes it (fake $100k cash, real marks). Mention buy + sell briefly after listing picks — do not trade unless they ask.",
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
      description:
        "Close an open paper position; proceeds return to paper cash. Call for sell / close / exit / flatten intents (e.g. “sell NVDA”, “close my bitcoin”). Resolve the symbol from context or live portfolio if they say “it” / “that”.",
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
