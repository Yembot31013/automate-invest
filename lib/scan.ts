import { generateAlertReaction } from "@/lib/agent/reaction";
import {
  createBreakoutAlert,
  createDipAlert,
  sendDiscordAlert,
} from "@/lib/discord";
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
import { isCryptoPair } from "@/lib/symbols";
import { markAlertSent, wasAlertedRecently } from "@/lib/redis";
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
): Promise<{ alerts: AlertPayload[]; skipped: string[] }> {
  const alerts: AlertPayload[] = [];
  const skipped: string[] = [];

  const [series, sentiment, headlines] = await Promise.all([
    fetchDailyOhlc(symbol),
    isCryptoPair(symbol) ? Promise.resolve(null) : fetchNewsSentiment(symbol),
    fetchHeadlinesForSymbol(symbol, 2),
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

  return { alerts, skipped };
}

/** Scan a watchlist and optionally post Discord alerts. */
export async function runMarketScan(
  watchlist: WatchlistEntry[],
  options: { postDiscord?: boolean } = {},
): Promise<ScanResult> {
  const postDiscord = options.postDiscord !== false;
  const result: ScanResult = {
    scanned: watchlist.length,
    alerted: [],
    skipped: [],
    errors: [],
  };

  const outcomes = await mapPool(watchlist, 3, async (entry) => {
    try {
      const { alerts, skipped } = await evaluateSymbol(
        entry.symbol,
        entry.exchange,
      );
      const alerted: string[] = [];

      for (const alert of alerts) {
        if (postDiscord) {
          const reaction = await generateAlertReaction(alert);
          await sendDiscordAlert(alert, reaction);
        }
        await markAlertSent(alert.snapshot.symbol, alert.type);
        alerted.push(`${alert.snapshot.symbol}:${alert.type}`);
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
      result.errors.push({ symbol: watchlist[i].symbol, message: outcome.error });
    }
  }

  return result;
}
