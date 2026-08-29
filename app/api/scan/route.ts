import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getUserWatchlist } from "@/lib/redis";
import { runMarketScan } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Authenticated on-demand scan for the signed-in user's watchlist.
 * Posts to Discord when rules fire (same suppression as cron).
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const watchlist = await getUserWatchlist(userId);
    if (watchlist.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Your watchlist is empty — monitor a ticker first.",
        },
        { status: 400 },
      );
    }

    const result = await runMarketScan(watchlist, { postDiscord: true });
    logger.info("api/scan", "user scan completed", { userId, ...result });
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Scan failed";
    logger.error("api/scan", "failed", { userId, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
