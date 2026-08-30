import { mapPool } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import {
  buildMarketSnapshot,
  fetchDailyOhlc,
  fetchHeadlinesForSymbol,
  fetchNewsSentiment,
  isPromisingBreakout,
  isSharpDip,
} from "@/lib/market";
import { isCryptoPair } from "@/lib/symbols";
import type { Recommendation, WatchlistEntry } from "@/types";

function scoreSnapshot(rec: Omit<Recommendation, "score">): number {
  const { snapshot, type } = rec;
  const headlineBoost = snapshot.headlines?.length ? 2 : 0;
  if (type === "dip") {
    return (
      snapshot.pctBelowSma14 * 10 +
      Math.min(snapshot.volumeRatio, 5) +
      headlineBoost
    );
  }
  if (type === "breakout") {
    return (
      snapshot.volumeRatio * 12 +
      Math.max(snapshot.changePct, 0) * 2 +
      (snapshot.sentimentScore ?? 0) * 5 +
      headlineBoost
    );
  }
  return Math.abs(snapshot.changePct) + snapshot.volumeRatio;
}

/**
 * Rank watchlist symbols using dip / breakout rules.
 * Empty watchlist → empty recommendations (no silent default universe).
 */
export async function recommendFromWatchlist(
  watchlist: WatchlistEntry[],
  limit = 5,
): Promise<Recommendation[]> {
  if (!watchlist.length) {
    return [];
  }

  const batches = await mapPool(watchlist, 4, async (entry) => {
    try {
      const [series, sentiment, headlines] = await Promise.all([
        fetchDailyOhlc(entry.symbol),
        isCryptoPair(entry.symbol)
          ? Promise.resolve(null)
          : fetchNewsSentiment(entry.symbol),
        fetchHeadlinesForSymbol(entry.symbol, 2),
      ]);
      if (!series.bars.length) {
        return [] as Recommendation[];
      }
      const snapshot = buildMarketSnapshot(
        series,
        entry.exchange,
        sentiment,
        headlines,
      );
      const out: Recommendation[] = [];

      if (isSharpDip(snapshot)) {
        const headline = headlines[0]?.headline;
        const base = {
          symbol: entry.symbol,
          exchange: entry.exchange,
          type: "dip" as const,
          reason:
            `Trading ${snapshot.pctBelowSma14.toFixed(1)}% below the 14-day SMA with vol ${snapshot.volumeRatio.toFixed(2)}× avg.` +
            (headline ? ` Catalyst: ${headline}` : ""),
          snapshot,
        };
        out.push({ ...base, score: scoreSnapshot(base) });
      }

      if (isPromisingBreakout(snapshot)) {
        const headline = headlines[0]?.headline;
        const base = {
          symbol: entry.symbol,
          exchange: entry.exchange,
          type: "breakout" as const,
          reason:
            `Volume ${snapshot.volumeRatio.toFixed(2)}× the 20-day avg with price ${snapshot.changePct >= 0 ? "up" : "flat"} and sentiment ${snapshot.sentimentScore ?? "n/a"}.` +
            (headline ? ` Catalyst: ${headline}` : ""),
          snapshot,
        };
        out.push({ ...base, score: scoreSnapshot(base) });
      }

      return out;
    } catch (error) {
      logger.error("recommend", "symbol failed", {
        symbol: entry.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as Recommendation[];
    }
  });

  return batches
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
