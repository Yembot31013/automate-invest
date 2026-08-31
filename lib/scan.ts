import { generateAlertReaction } from "@/lib/agent/reaction";
import { runAutoTradeForUserAlert } from "@/lib/auto-trade";
import { getClerkUserEmail } from "@/lib/clerk-user";
import {
  createBreakoutAlert,
  createDipAlert,
} from "@/lib/discord";
import { appendDeskEvent } from "@/lib/desk-events";
import { getDeskSettings } from "@/lib/desk-settings-store";
import { sendAttentionEmail } from "@/lib/email/attention";
import { mapPool } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import {
  buildMarketSnapshot,
  fetchDailyOhlc,
  fetchHeadlinesForSymbol,
  fetchNewsSentiment,
  isPromisingBreakout,
  isSharpDip,
  MarketDataError,
} from "@/lib/market";
import { isCryptoPair, isNgxExchange } from "@/lib/symbols";
import {
  getSymbolWatchers,
  getTriggerCoverage,
  markAlertSent,
  wasAlertedRecently,
} from "@/lib/redis";
import { runTriggersAgainstSnapshot } from "@/lib/trigger-fire";
import { listUserTriggers } from "@/lib/triggers-store";
import { mergeScanUniverse } from "@/lib/triggers";
import type { AlertPayload, ScanResult, WatchlistEntry } from "@/types";

const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { symbol: "SPY", exchange: "NYSE", addedAt: new Date(0).toISOString() },
  { symbol: "QQQ", exchange: "NASDAQ", addedAt: new Date(0).toISOString() },
  { symbol: "AAPL", exchange: "NASDAQ", addedAt: new Date(0).toISOString() },
  { symbol: "NVDA", exchange: "NASDAQ", addedAt: new Date(0).toISOString() },
  { symbol: "MSFT", exchange: "NASDAQ", addedAt: new Date(0).toISOString() },
];

export function withDefaultWatchlist(
  stored: WatchlistEntry[],
): WatchlistEntry[] {
  return stored.length > 0 ? stored : DEFAULT_WATCHLIST;
}

async function evaluateSymbol(
  symbol: string,
  exchange: string,
  options: { userId?: string; notify: boolean },
): Promise<{ alerts: AlertPayload[]; skipped: string[]; triggers: string[] }> {
  const alerts: AlertPayload[] = [];
  const skipped: string[] = [];

  const [series, sentiment, headlines] = await Promise.all([
    fetchDailyOhlc(symbol, undefined, exchange),
    isCryptoPair(symbol) || isNgxExchange(exchange)
      ? Promise.resolve(null)
      : fetchNewsSentiment(symbol),
    fetchHeadlinesForSymbol(symbol, 2, exchange),
  ]);

  if (!series.bars.length) {
    throw new MarketDataError(`Empty OHLC data for ${symbol}`);
  }

  const snapshot = buildMarketSnapshot(
    series,
    exchange,
    sentiment,
    headlines,
  );

  if (isSharpDip(snapshot)) {
    if (await wasAlertedRecently(symbol, "dip")) {
      skipped.push(`${symbol}:dip`);
    } else {
      const alert = createDipAlert(snapshot);
      if (headlines[0]?.headline) {
        alert.description = `${alert.description}\n\n**Catalyst:** ${headlines[0].headline}`;
      }
      alerts.push(alert);
    }
  }

  if (isPromisingBreakout(snapshot)) {
    if (await wasAlertedRecently(symbol, "breakout")) {
      skipped.push(`${symbol}:breakout`);
    } else {
      const alert = createBreakoutAlert(snapshot);
      if (headlines[0]?.headline) {
        alert.description = `${alert.description}\n\n**Catalyst:** ${headlines[0].headline}`;
      }
      alerts.push(alert);
    }
  }

  const triggers = await runTriggersAgainstSnapshot({
    snapshot,
    userId: options.userId,
    notify: options.notify,
  });

  return { alerts, skipped, triggers };
}

async function notifyUserAttention(params: {
  userId: string;
  alert: AlertPayload;
  reactionLine: string | null;
  autoUnsure?: boolean;
  extraPoints?: string[];
}): Promise<void> {
  const { userId, alert, reactionLine, autoUnsure, extraPoints } = params;
  const email = await getClerkUserEmail(userId);
  const points = [
    ...(extraPoints ?? []),
    `${alert.snapshot.symbol} · ${alert.type} · mark ~$${alert.snapshot.currentPrice.toFixed(2)} (${alert.snapshot.changePct >= 0 ? "+" : ""}${alert.snapshot.changePct.toFixed(2)}%)`,
    "Open the desk to act — or ignore if you disagree.",
  ];

  if (email) {
    const sent = await sendAttentionEmail({
      to: email,
      alert,
      reactionLine,
      points,
      autoUnsure,
    });
    if (!sent.ok) {
      logger.error("scan", "attention email failed", {
        userId,
        error: sent.error,
      });
    }
  } else {
    logger.error("scan", "no email for attention", { userId });
  }

  const chip = autoUnsure
    ? `Attention (Auto unsure): ${alert.snapshot.symbol} ${alert.type} — check the desk`
    : `Attention: ${alert.snapshot.symbol} ${alert.type} — emailed you the tape notes`;

  await appendDeskEvent(userId, {
    kind: "attention",
    text: chip,
    symbol: alert.snapshot.symbol,
  });
}

/**
 * Deliver Attention (+ optional Auto) for one user and one alert.
 */
export async function deliverAlertToUser(params: {
  userId: string;
  alert: AlertPayload;
  reactionLine: string | null;
}): Promise<void> {
  const { userId, alert, reactionLine } = params;
  const settings = await getDeskSettings(userId);

  if (settings.autoTradeEnabled) {
    const result = await runAutoTradeForUserAlert({ userId, alert });
    if (result.traded && !result.attentionOnly) {
      // Still send a short Attention so they know something moved while away
      await notifyUserAttention({
        userId,
        alert,
        reactionLine,
        extraPoints: result.summaries,
      });
      return;
    }
    if (result.attentionOnly || result.summaries.length > 0) {
      await notifyUserAttention({
        userId,
        alert,
        reactionLine,
        autoUnsure: true,
        extraPoints: result.summaries,
      });
      return;
    }
  }

  await notifyUserAttention({ userId, alert, reactionLine });
}

export type RunMarketScanOptions = {
  /** When set, only notify this user (on-demand scan). */
  userId?: string;
  /** Deliver Attention mail + chat chips (default true). */
  notify?: boolean;
};

/** Scan a watchlist and deliver personalized Attention (and Auto when enabled). */
export async function runMarketScan(
  watchlist: WatchlistEntry[],
  options: RunMarketScanOptions = {},
): Promise<ScanResult> {
  const notify = options.notify !== false;
  const coverage = options.userId
    ? (await listUserTriggers(options.userId)).map((t) => ({
        symbol: t.symbol,
        exchange: t.exchange,
        addedAt: t.createdAt,
      }))
    : await getTriggerCoverage();
  const universe = mergeScanUniverse(watchlist, coverage);
  const result: ScanResult = {
    scanned: universe.length,
    alerted: [],
    skipped: [],
    errors: [],
  };

  const outcomes = await mapPool(universe, 3, async (entry) => {
    try {
      const { alerts, skipped, triggers } = await evaluateSymbol(
        entry.symbol,
        entry.exchange,
        { userId: options.userId, notify },
      );
      const alerted: string[] = [];

      for (const alert of alerts) {
        if (notify) {
          const reaction = await generateAlertReaction(alert);
          if (options.userId) {
            await deliverAlertToUser({
              userId: options.userId,
              alert,
              reactionLine: reaction,
            });
          } else {
            const watchers = await getSymbolWatchers(alert.snapshot.symbol);
            await mapPool(watchers, 2, async (uid) => {
              await deliverAlertToUser({
                userId: uid,
                alert,
                reactionLine: reaction,
              });
              return null;
            });
          }
        }
        await markAlertSent(alert.snapshot.symbol, alert.type);
        alerted.push(`${alert.snapshot.symbol}:${alert.type}`);
      }

      for (const t of triggers) {
        if (!t.endsWith(":suppressed")) {
          alerted.push(`trigger:${t}`);
        } else {
          skipped.push(`trigger:${t}`);
        }
      }

      return { alerted, skipped, error: null as string | null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown scan error";
      logger.error("scan", "symbol failed", {
        symbol: entry.symbol,
        error: message,
      });
      return {
        alerted: [] as string[],
        skipped: [] as string[],
        error: message,
      };
    }
  });

  for (let i = 0; i < outcomes.length; i += 1) {
    const outcome = outcomes[i];
    result.alerted.push(...outcome.alerted);
    result.skipped.push(...outcome.skipped);
    if (outcome.error) {
      result.errors.push({
        symbol: universe[i]!.symbol,
        message: outcome.error,
      });
    }
  }

  return result;
}
