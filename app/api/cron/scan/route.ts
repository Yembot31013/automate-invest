import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getSystemWatchlist } from "@/lib/redis"; 
import { runMarketScan, withDefaultWatchlist } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const watchlist = withDefaultWatchlist(await getSystemWatchlist());
    const result = await runMarketScan(watchlist, { notify: true });
    logger.info("cron/scan", "completed", { ...result });
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cron scan failed";
    logger.error("cron/scan", "fatal", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
