import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { mapPool } from "@/lib/concurrency";
import { DESK_SNAPSHOT_LIMIT } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { getPortfolioSummary, loadSnapshot } from "@/lib/paper";
import { getUserWatchlist } from "@/lib/redis";
import { listUserTriggers } from "@/lib/triggers-store";
import { MAX_USER_TRIGGERS } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const watchlist = await getUserWatchlist(userId);
    const portfolio = await getPortfolioSummary(userId);
    const triggers = await listUserTriggers(userId);

    const snapshots = await mapPool(
      watchlist.slice(0, DESK_SNAPSHOT_LIMIT),
      4,
      async (entry) => {
        try {
          const snap = await loadSnapshot(entry.symbol, entry.exchange);
          return {
            symbol: snap.symbol,
            exchange: snap.exchange,
            currentPrice: snap.currentPrice,
            changePct: snap.changePct,
            volumeRatio: snap.volumeRatio,
            pctBelowSma14: snap.pctBelowSma14,
            sentimentScore: snap.sentimentScore,
            closes: snap.closes.slice(-20),
            headline: snap.headlines[0]?.headline ?? null,
          };
        } catch (error) {
          logger.error("api/desk", "snapshot failed", {
            symbol: entry.symbol,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            symbol: entry.symbol,
            exchange: entry.exchange,
            error: error instanceof Error ? error.message : "Failed",
          };
        }
      },
    );

    return NextResponse.json({
      watchlist,
      triggers,
      triggerLimit: MAX_USER_TRIGGERS,
      snapshots,
      portfolio: {
        openCount: portfolio.openCount,
        cash: portfolio.cash,
        equity: portfolio.equity,
        totalCost: portfolio.totalCost,
        totalMarketValue: portfolio.totalMarketValue,
        totalUnrealizedPnl: portfolio.totalUnrealizedPnl,
        totalUnrealizedPnlPct: portfolio.totalUnrealizedPnlPct,
        positions: portfolio.positions,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load desk data";
    logger.error("api/desk", message, { userId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
