import { tool } from "ai";
import { z } from "zod";

import { verifyTradableSymbolDetailed } from "@/lib/market";
import {
  formatStructureSetup,
  pickBestStructureScan,
  scanForexStructureAllTimeframes,
  scanForexStructureDetailed,
} from "@/lib/structure-scanner";
import { normalizeStructureTimeframe } from "@/lib/structure/timeframes";
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
  paperSellMany,
} from "@/lib/paper";
import { recommendFromWatchlist } from "@/lib/recommend";
import {
  addToUserWatchlist,
  getUserWatchlist,
  removeFromUserWatchlist,
} from "@/lib/redis";
import { getDeskSettings } from "@/lib/desk-settings-store";
import {
  AUTO_TRADE_DISCLAIMER,
  AUTO_TRADE_QUIZ_VERSION,
} from "@/lib/desk-settings";
import { sendCapabilityGapEmail } from "@/lib/email/resend";
import { MAX_USER_TRIGGERS, MAX_USER_WATCHLIST } from "@/lib/limits";
import {
  findWatchlistSymbol,
  isForexPair,
  resolveSymbolInput,
} from "@/lib/symbols";
import { computeWhatIf } from "@/lib/whatif";
import {
  createUserTrigger,
  listUserTriggers,
  removeUserTrigger,
  setUserTriggerEnabled,
  updateUserTrigger,
} from "@/lib/triggers-store";
import {
  findTriggersForSymbol,
  formatTriggerSummary,
  normalizeAutoPauseAfterFire,
  normalizeNotionalUsd,
  normalizeTriggerCondition,
  normalizeTriggerSellClose,
  TRIGGER_CONDITION_HINT,
  TriggerLimitError,
  type TriggerAction,
} from "@/lib/triggers";
import { formatGuardrailsSummary } from "@/lib/trigger-guardrails";
import { loadTriggerBookContext } from "@/lib/trigger-sync";
import { getTradeHistory } from "@/lib/trade-audit";
import { createToolDedupeCache } from "@/lib/agent/tool-dedupe";
import { mapPool } from "@/lib/concurrency";
import {
  validateTriggerCreate,
  validateTriggerEnable,
  validateTriggerUpdate,
} from "@/lib/trigger-validate";

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
  const dedupe = createToolDedupeCache();

  return {
    getSnapshot: tool({
      description:
        "Fetch a live market snapshot for ONE symbol (price, SMA, volume ratio, sentiment, recent headlines with short summaries). For several tickers at once, use getSnapshots or getWatchlistTape instead — do NOT fire parallel getSnapshot calls.",
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
        const key = `getSnapshot:${resolved.symbol}:${exchange ?? resolved.exchange}`;
        return dedupe(key, async () => {
          const snapshot = await loadSnapshot(
            resolved.symbol,
            exchange ?? resolved.exchange,
          );
          return slimSnapshot(snapshot);
        });
      },
    }),

    getSnapshots: tool({
      description:
        "Fetch live snapshots for multiple symbols in ONE call (max 12). Use when you need tape/headlines on several names — never parallel getSnapshot.",
      inputSchema: z.object({
        symbols: z
          .array(z.string())
          .min(1)
          .max(12)
          .describe("Tickers or pairs to snapshot together"),
      }),
      execute: async ({ symbols }) => {
        const key = `getSnapshots:${symbols.map((s) => s.trim().toUpperCase()).sort().join(",")}`;
        return dedupe(key, async () => {
          const snapshots = await mapPool(symbols, 4, async (raw) => {
            try {
              const resolved = resolveSymbolInput(raw);
              const snapshot = await loadSnapshot(
                resolved.symbol,
                resolved.exchange,
              );
              return { ok: true as const, ...slimSnapshot(snapshot) };
            } catch (error) {
              return {
                ok: false as const,
                symbol: raw.trim().toUpperCase(),
                error:
                  error instanceof Error
                    ? error.message
                    : "Snapshot failed for that symbol",
              };
            }
          });
          return {
            count: snapshots.filter((row) => row.ok).length,
            snapshots,
          };
        });
      },
    }),

    getWatchlistTape: tool({
      description:
        "One call: live price, day %, and headlines for every symbol on the user's watchlist. Use for board overview or casual 'what's on your mind' — not parallel getSnapshot per ticker.",
      inputSchema: z.object({}),
      execute: async () =>
        dedupe("getWatchlistTape", async () => {
          const watchlist = await getUserWatchlist(userId);
          if (watchlist.length === 0) {
            return {
              count: 0,
              snapshots: [],
              message: "Watchlist is empty — nothing to tape yet.",
            };
          }
          const snapshots = await mapPool(watchlist, 4, async (entry) => {
            try {
              const snapshot = await loadSnapshot(entry.symbol, entry.exchange);
              return { ok: true as const, ...slimSnapshot(snapshot) };
            } catch (error) {
              return {
                ok: false as const,
                symbol: entry.symbol,
                error:
                  error instanceof Error
                    ? error.message
                    : "Snapshot failed for that symbol",
              };
            }
          });
          return {
            count: snapshots.filter((row) => row.ok).length,
            snapshots,
          };
        }),
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

    getDeskAutomation: tool({
      description:
        "Read Attention vs Auto-trade status, plus a summary of user Triggers. Call when the user asks about auto trading, Attention mail, triggers/alerts rules, why something did or didn't sell, Discord alerts, or how automation works. You cannot enable/disable Auto from tools — point them to the Activity Auto toggle + quiz. For Triggers, use listTriggers / createTrigger / setTriggerEnabled / removeTrigger.",
      inputSchema: z.object({}),
      execute: async () => {
        const [settings, triggers] = await Promise.all([
          getDeskSettings(userId),
          listUserTriggers(userId),
        ]);
        return {
          attentionMail:
            "Personalized email + chat system chip. Never trades. Default for scan alerts.",
          autoTradeEnabled: settings.autoTradeEnabled,
          autoTradeEnabledAt: settings.autoTradeEnabledAt,
          quizVersionRequired: AUTO_TRADE_QUIZ_VERSION,
          quizVersionAcked: settings.autoTradeQuizVersion,
          exits:
            "Paper sell owned positions (stop-loss / take-profit with trail giveback).",
          entries: settings.allowAutoBuys
            ? "Paper buy from your watchlist when dip rules fire (not the whole market)."
            : "Watchlist auto-buys are off in settings.",
          takeProfitPct: settings.takeProfitPct,
          stopLossPct: settings.stopLossPct,
          trailGivebackPct: settings.trailGivebackPct,
          maxBuyNotionalUsd: settings.maxBuyNotionalUsd,
          maxBuysPerDay: settings.maxBuysPerDay,
          guardrails: {
            enabled: settings.guardrailsEnabled,
            summary: formatGuardrailsSummary(settings),
            maxSymbolExposureUsd: settings.maxSymbolExposureUsd,
            maxTriggerBuysPerDay: settings.maxTriggerBuysPerDay,
            maxTriggerSpendPerDayUsd: settings.maxTriggerSpendPerDayUsd,
            pauseTriggerBuysWhenBookDownPct:
              settings.pauseTriggerBuysWhenBookDownPct,
            howToEdit: "Activity panel → Guardrails",
          },
          howToEnable:
            "Activity panel → Auto-trade → agree + short quiz (again after every disable).",
          expectation:
            "Auto helps and usually works, but it isn’t perfect — misreads and second-guessable calls can happen; user owns leaving it on.",
          disclaimerSummary: AUTO_TRADE_DISCLAIMER,
          discordAlerts: false,
          triggers: {
            count: triggers.length,
            limit: MAX_USER_TRIGGERS,
            enabled: triggers.filter((t) => t.enabled).length,
            summaries: triggers.map(formatTriggerSummary),
            note: "User-defined rules checked on cron/scan (day %, price, or profit on your lot). Buy + sell brackets on one ticker are OK. Separate from Auto-trade dip/breakout system rules.",
          },
        };
      },
    }),

    listTriggers: tool({
      description:
        "List the user's Triggers (custom day-move or price rules with alert / paper buy / paper sell). Call when they ask what rules are armed, or before editing triggers.",
      inputSchema: z.object({}),
      execute: async () => {
        const triggers = await listUserTriggers(userId);
        return {
          triggers,
          limit: MAX_USER_TRIGGERS,
          summaries: triggers.map(formatTriggerSummary),
        };
      },
    }),

    createTrigger: tool({
      description:
        "Create a user Trigger (same rules as Add → Trigger). Conditions: day_drop_pct / day_gain_pct / price_below / price_above / profit_usd_above / profit_pct_above (sell only — your lot's unrealized profit). Threshold MUST be positive (3 = −3% day for day_drop). Vague 'any negative' is NOT 0 — ask for a concrete %. paper_buy needs notionalUsd (25–5000) and enough paper cash; paper_sell closes all lots OR a partial slice (sellCloseMode: all | pct | usd + sellCloseValue). Brackets (dip buy + take-profit sell) on one ticker are allowed. Rejects exact duplicates and day-drop buy+sell collision. Max " +
        String(MAX_USER_TRIGGERS) +
        ". Does NOT require Auto-trade.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker, e.g. GOOG, NVDA, BTC/USD"),
        exchange: z.string().optional(),
        conditionKind: z
          .enum([
            "day_drop_pct",
            "day_gain_pct",
            "price_below",
            "price_above",
            "profit_usd_above",
            "profit_pct_above",
          ])
          .describe(
            "When rule: day_drop_pct (day ≤ −value%), day_gain_pct (day ≥ +value%), price_below / price_above, profit_usd_above (sell: profit ≥ $value on your lot), profit_pct_above (sell: profit ≥ value%)",
          ),
        value: z
          .number()
          .describe(
            "Positive threshold only (same as Add modal Threshold). Day %: 3 means 3 points, not −3. Price: absolute mark > 0. Never 0.",
          ),
        action: z
          .enum(["attention", "paper_buy", "paper_sell"])
          .describe(
            "Matches Add modal Then: attention = email + chat chip; paper_buy / paper_sell = paper book",
          ),
        notionalUsd: z
          .number()
          .positive()
          .optional()
          .describe(
            "Paper-buy size in USD (default 1000, max 5000). Required intent for paper_buy — pass the dollar budget they asked for.",
          ),
        autoPauseAfterFire: z
          .boolean()
          .optional()
          .describe(
            "When true, rule pauses after it successfully fires. Default on for paper buy/sell, off for alert-only.",
          ),
        sellCloseMode: z
          .enum(["all", "pct", "usd"])
          .optional()
          .describe(
            "paper_sell only: all = close every open lot; pct = sell % of newest lot; usd = sell ~$ value from newest lot.",
          ),
        sellCloseValue: z
          .number()
          .positive()
          .optional()
          .describe(
            "paper_sell partial size: percent 1–99 when sellCloseMode=pct, or USD when sellCloseMode=usd.",
          ),
      }),
      execute: async ({
        symbol,
        exchange,
        conditionKind,
        value,
        action,
        notionalUsd,
        autoPauseAfterFire,
        sellCloseMode,
        sellCloseValue,
      }) => {
        const condition = normalizeTriggerCondition({
          kind: conditionKind,
          value,
        });
        if (!condition) {
          return {
            ok: false,
            error: TRIGGER_CONDITION_HINT,
            limitHit: false,
          };
        }
        try {
          const resolved = resolveSymbolInput(symbol, exchange);
          const watchlist = await getUserWatchlist(userId);
          const watched = watchlist.find(
            (entry) =>
              entry.symbol.toUpperCase() === resolved.symbol.toUpperCase(),
          );
          const verified = watched
            ? { symbol: watched.symbol, exchange: watched.exchange }
            : await verifyTradableSymbolDetailed(symbol, exchange);
          const size = normalizeNotionalUsd(notionalUsd);
          const sellClose = normalizeTriggerSellClose(
            action as TriggerAction,
            sellCloseMode,
            sellCloseValue,
          );
          const [existing, book, settings] = await Promise.all([
            listUserTriggers(userId),
            loadTriggerBookContext(userId),
            getDeskSettings(userId),
          ]);
          const readiness = validateTriggerCreate({
            symbol: verified.symbol,
            condition,
            action: action as TriggerAction,
            notionalUsd: size,
            sellCloseMode: sellClose.sellCloseMode,
            sellCloseValue: sellClose.sellCloseValue,
            existing,
            book,
            guardrails: settings,
          });
          if (!readiness.ok) {
            return { ok: false, error: readiness.error, limitHit: false };
          }
          const trigger = await createUserTrigger(userId, {
            symbol: verified.symbol,
            exchange: verified.exchange,
            condition,
            action: action as TriggerAction,
            notionalUsd: size,
            sellCloseMode: sellClose.sellCloseMode,
            sellCloseValue: sellClose.sellCloseValue,
            autoPauseAfterFire: normalizeAutoPauseAfterFire(
              autoPauseAfterFire,
              action as TriggerAction,
            ),
          });
          const triggers = await listUserTriggers(userId);
          return {
            ok: true,
            trigger,
            summary: formatTriggerSummary(trigger),
            triggers,
            limit: MAX_USER_TRIGGERS,
          };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : "Couldn't create trigger",
            limitHit: error instanceof TriggerLimitError,
          };
        }
      },
    }),

    updateTrigger: tool({
      description:
        "Edit an existing trigger (listTriggers first when unsure). Pass triggerId, or symbol when exactly one rule matches. Updates condition, action, size, autoPauseAfterFire, or enabled. If several rules share a ticker, returns candidates — ask which one or pass triggerId. Rejects duplicates and day-drop buy+sell collision.",
      inputSchema: z.object({
        triggerId: z.string().optional(),
        symbol: z
          .string()
          .optional()
          .describe("Use when one trigger on this ticker — else pass triggerId"),
        conditionKind: z
          .enum([
            "day_drop_pct",
            "day_gain_pct",
            "price_below",
            "price_above",
            "profit_usd_above",
            "profit_pct_above",
          ])
          .optional(),
        value: z.number().optional(),
        action: z.enum(["attention", "paper_buy", "paper_sell"]).optional(),
        notionalUsd: z.number().positive().optional(),
        sellCloseMode: z.enum(["all", "pct", "usd"]).optional(),
        sellCloseValue: z.number().positive().optional(),
        autoPauseAfterFire: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async (input) => {
        const existing = await listUserTriggers(userId);
        let target = input.triggerId
          ? existing.find((t) => t.id === input.triggerId)
          : undefined;

        if (!target && input.symbol?.trim()) {
          const matches = findTriggersForSymbol(existing, input.symbol);
          if (matches.length === 0) {
            return {
              ok: false,
              error: `No trigger found for ${input.symbol.trim().toUpperCase()}.`,
            };
          }
          if (matches.length > 1) {
            return {
              ok: false,
              error: `Several triggers on ${input.symbol.trim().toUpperCase()} — pass triggerId.`,
              candidates: matches.map((t) => ({
                id: t.id,
                summary: formatTriggerSummary(t),
              })),
            };
          }
          target = matches[0];
        }

        if (!target) {
          return {
            ok: false,
            error: "Pass triggerId or a symbol with exactly one trigger.",
          };
        }

        const hasPatch =
          input.conditionKind !== undefined ||
          input.value !== undefined ||
          input.action !== undefined ||
          input.notionalUsd !== undefined ||
          input.sellCloseMode !== undefined ||
          input.sellCloseValue !== undefined ||
          input.autoPauseAfterFire !== undefined ||
          input.enabled !== undefined;

        if (!hasPatch) {
          return {
            ok: false,
            error:
              "Nothing to change — pass condition, action, notionalUsd, sellCloseMode, autoPauseAfterFire, or enabled.",
          };
        }

        const nextCondition =
          input.conditionKind !== undefined || input.value !== undefined
            ? normalizeTriggerCondition({
                kind: input.conditionKind ?? target.condition.kind,
                value: input.value ?? target.condition.value,
              })
            : target.condition;
        if (!nextCondition) {
          return { ok: false, error: TRIGGER_CONDITION_HINT };
        }

        const nextAction = (input.action ?? target.action) as TriggerAction;
        const nextNotional = normalizeNotionalUsd(
          input.notionalUsd ?? target.notionalUsd,
        );
        const nextSellClose = normalizeTriggerSellClose(
          nextAction,
          input.sellCloseMode ?? target.sellCloseMode,
          input.sellCloseValue ?? target.sellCloseValue,
        );
        const nextEnabled = input.enabled ?? target.enabled;
        const nextAutoPause =
          input.autoPauseAfterFire !== undefined
            ? input.autoPauseAfterFire
            : target.autoPauseAfterFire;

        const [book, settings] = await Promise.all([
          loadTriggerBookContext(userId),
          getDeskSettings(userId),
        ]);
        const readiness = validateTriggerUpdate({
          triggerId: target.id,
          symbol: target.symbol,
          condition: nextCondition,
          action: nextAction,
          notionalUsd: nextNotional,
          sellCloseMode: nextSellClose.sellCloseMode,
          sellCloseValue: nextSellClose.sellCloseValue,
          enabled: nextEnabled,
          existing,
          book,
          guardrails: settings,
        });
        if (!readiness.ok) {
          return { ok: false, error: readiness.error };
        }

        const trigger = await updateUserTrigger(userId, target.id, {
          condition: nextCondition,
          action: nextAction,
          notionalUsd: nextNotional,
          sellCloseMode: nextSellClose.sellCloseMode,
          sellCloseValue: nextSellClose.sellCloseValue,
          autoPauseAfterFire: nextAutoPause,
          enabled: nextEnabled,
        });
        if (!trigger) {
          return { ok: false, error: "Trigger not found" };
        }
        const triggers = await listUserTriggers(userId);
        return {
          ok: true,
          trigger,
          summary: formatTriggerSummary(trigger),
          triggers,
        };
      },
    }),

    setTriggerEnabled: tool({
      description:
        "Enable or disable an existing Trigger by id (from listTriggers). Enabling re-checks cash, guardrails, duplicates, and dip collisions.",
      inputSchema: z.object({
        triggerId: z.string(),
        enabled: z.boolean(),
      }),
      execute: async ({ triggerId, enabled }) => {
        if (enabled) {
          const existing = await listUserTriggers(userId);
          const current = existing.find((t) => t.id === triggerId);
          if (!current) {
            return { ok: false, error: "Trigger not found" };
          }
          const [book, settings] = await Promise.all([
            loadTriggerBookContext(userId),
            getDeskSettings(userId),
          ]);
          const readiness = validateTriggerEnable({
            trigger: current,
            existing,
            book,
            guardrails: settings,
          });
          if (!readiness.ok) {
            return { ok: false, error: readiness.error };
          }
        }
        const trigger = await setUserTriggerEnabled(
          userId,
          triggerId,
          enabled,
        );
        if (!trigger) {
          return { ok: false, error: "Trigger not found" };
        }
        return {
          ok: true,
          trigger,
          summary: formatTriggerSummary(trigger),
        };
      },
    }),

    removeTrigger: tool({
      description:
        "Delete a Trigger by id (from listTriggers). Permanent remove — use setTriggerEnabled to pause instead when they only want it off for now.",
      inputSchema: z.object({
        triggerId: z.string(),
      }),
      execute: async ({ triggerId }) => {
        const { removed, triggers } = await removeUserTrigger(
          userId,
          triggerId,
        );
        if (!removed) {
          return { ok: false, error: "Trigger not found" };
        }
        return {
          ok: true,
          removed,
          summary: formatTriggerSummary(removed),
          triggers,
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
        "Remove one ticker from the user's watchlist. Call for 'remove it', 'take that off', 'drop BTC', 'stop watching dangote/amazon'. Resolve Nigerian names to NGX tickers (dangote → DANGCEM). If unsure which symbol, call listWatchlist first. ONLY claim removal when this tool returns removed: true — if removed: false / ok: false, say it was not on the list.",
      inputSchema: z.object({
        symbol: z
          .string()
          .describe(
            "Ticker or casual name to remove, e.g. BTC, AMZN, GOOG, DANGCEM, dangote",
          ),
      }),
      execute: async ({ symbol }) => {
        const before = await getUserWatchlist(userId);
        const matched = findWatchlistSymbol(before, symbol);
        if (!matched) {
          const fallback =
            resolveSymbolInput(symbol).symbol || symbol.trim().toUpperCase();
          return {
            ok: false,
            removed: false,
            symbol: fallback,
            wasPresent: false,
            watchlist: before,
            message: `${fallback} was not on the watchlist — nothing removed. Live list: ${before.map((e) => e.symbol).join(", ") || "(empty)"}`,
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
        const position = await paperBuy({
          userId,
          ...input,
          audit: { source: "manual" },
        });
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
        "Close ONE open paper position; proceeds return to paper cash. Use for a single ticker (“sell NVDA”, “close my bitcoin”). For sell all / liquidate everything / close several names at once, use paperSellMany instead — do NOT fire many parallel paperSell calls.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        positionId: z.string().optional(),
        exitPrice: z.number().positive().optional(),
      }),
      execute: async (input) => {
        const position = await paperSell({
          userId,
          ...input,
          audit: { source: "manual" },
        });
        return {
          ok: true,
          id: position.id,
          symbol: position.symbol,
          exitPrice: position.exitPrice,
          unrealizedPnl: Number(position.unrealizedPnl.toFixed(2)),
          unrealizedPnlPct: Number(position.unrealizedPnlPct.toFixed(2)),
          cashRemaining: Number(position.cashRemaining.toFixed(2)),
        };
      },
    }),

    paperSellMany: tool({
      description:
        "Close multiple open paper positions in one atomic update. Use for “sell all”, “liquidate”, “close everything”, or selling several tickers at once. Prefer sellAll: true for flatten-the-book. Returns closedCount + remainingOpen — only claim flat when remainingOpen is 0.",
      inputSchema: z.object({
        sellAll: z
          .boolean()
          .optional()
          .describe("If true, close every open paper position"),
        symbols: z
          .array(z.string())
          .optional()
          .describe(
            "Specific tickers to close when not selling all, e.g. [\"NVDA\", \"BTC/USD\"]",
          ),
      }),
      execute: async (input) => {
        try {
          return await paperSellMany({
            userId,
            ...input,
            audit: { source: "manual" },
          });
        } catch (error) {
          return {
            ok: false,
            closedCount: 0,
            closed: [],
            cashRemaining: 0,
            remainingOpen: -1,
            error:
              error instanceof Error
                ? error.message
                : "Could not sell those paper positions",
          };
        }
      },
    }),

    portfolioPnL: tool({
      description:
        "Mark-to-market summary of open paper positions plus remaining cash and equity. Call at most ONCE per user message — never parallel duplicate calls.",
      inputSchema: z.object({}),
      execute: async () =>
        dedupe("portfolioPnL", async () => {
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
        }),
    }),

    tradeHistory: tool({
      description:
        "Durable paper trade log (buys, sells, skips with full numbers) — stored outside chat and survives clear. Use when they ask trading history, closed trades, realized PnL, what bought/sold when, or overnight fills after chat was cleared. NOT portfolioPnL (that is open book + unrealized only). Call at most ONCE per message.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return (default 50, newest first)"),
        symbol: z
          .string()
          .optional()
          .describe("Filter to one ticker, e.g. SOL/USD or TSLA"),
      }),
      execute: async ({ limit, symbol }) =>
        dedupe("tradeHistory", async () => {
          const { summary, entries } = await getTradeHistory({
            userId,
            limit,
            symbol,
          });
          return {
            summary,
            count: entries.length,
            entries,
          };
        }),
    }),

    getStructureSetup: tool({
      description:
        "Deterministic FX structure scan (BOS + FVG + order block). Returns setup map chart + levels in chat. Call proactively when the user is trade-curious on a forex pair (entry, levels, setup, SL/TP) — they do not have to say 'structure scan'. Default timeframe 2H; use allTimeframes for a full 1H/2H/4H/1D pass. At most once per user message. NOT for commodities/crypto or casual price-only checks.",
      inputSchema: z.object({
        symbol: z
          .string()
          .describe("Forex pair e.g. EUR/USD, GBP/USD, NZD/USD, EUR/AUD"),
        timeframe: z
          .enum(["1H", "2H", "4H", "1D"])
          .optional()
          .describe("Chart timeframe — default 2H (tester's primary FX frame)"),
        allTimeframes: z
          .boolean()
          .optional()
          .describe(
            "When true, scan 1H + 2H + 4H + 1D and return tabs for each hit",
          ),
      }),
      execute: async ({ symbol, timeframe, allTimeframes }) => {
        const resolved = resolveSymbolInput(symbol);
        const tf = normalizeStructureTimeframe(timeframe);
        const key = `getStructureSetup:${resolved.symbol}:${allTimeframes ? "all" : tf}`;
        return dedupe(key, async () => {
          if (!isForexPair(resolved.symbol)) {
            return {
              ok: false,
              error: `Structure scan is forex-only. ${resolved.symbol || symbol} is not a supported FX pair.`,
            };
          }

          if (allTimeframes) {
            const scans = await scanForexStructureAllTimeframes(resolved.symbol);
            const best = pickBestStructureScan(scans);
            const hits = scans.filter((s) => s.setup != null);
            if (!best?.setup) {
              return {
                ok: true,
                symbol: resolved.symbol,
                setup: null,
                chart: null,
                scans: scans.map((s) => ({
                  timeframe: s.timeframe,
                  setup: s.setup,
                  chart: s.chart,
                  barCount: s.barCount,
                })),
                message:
                  "No valid bullish BOS+FVG+OB setup on 1H, 2H, 4H, or 1D right now.",
              };
            }
            return {
              ok: true,
              symbol: resolved.symbol,
              setup: best.setup,
              chart: best.chart,
              scans: scans.map((s) => ({
                timeframe: s.timeframe,
                setup: s.setup,
                chart: s.chart,
                barCount: s.barCount,
              })),
              hitCount: hits.length,
              formatted: formatStructureSetup(best.setup),
            };
          }

          const row = await scanForexStructureDetailed(resolved.symbol, tf);
          if (!row.setup) {
            return {
              ok: true,
              symbol: resolved.symbol,
              timeframe: tf,
              setup: null,
              chart: null,
              message: `No valid bullish BOS+FVG+OB setup on ${tf} right now.`,
            };
          }
          return {
            ok: true,
            symbol: resolved.symbol,
            timeframe: tf,
            setup: row.setup,
            chart: row.chart,
            formatted: formatStructureSetup(row.setup),
          };
        });
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
