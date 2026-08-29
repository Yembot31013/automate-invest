import { NextResponse } from "next/server";

import {
  createBreakoutAlert,
  createDipAlert,
  sendDiscordAlert,
} from "@/lib/discord";
import {
  buildMarketSnapshot,
  fetchDailyOhlc,
  fetchNewsSentiment,
  isPromisingBreakout,
  isSharpDip,
  MarketDataError,
} from "@/lib/market";
import {
  getWatchlist,
  markAlertSent,
  wasAlertedRecently,
} from "@/lib/redis";
import type { AlertPayload, ScanResult } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_WATCHLIST = [
  { symbol: "SPY", exchange: "NYSE" },
  { symbol: "QQQ", exchange: "NASDAQ" },
  { symbol: "AAPL", exchange: "NASDAQ" },
  { symbol: "NVDA", exchange: "NASDAQ" },
  { symbol: "MSFT", exchange: "NASDAQ" },
] as const;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Allow local/dev without CRON_SECRET; require it in production.
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

async function resolveWatchlist() {
  const stored = await getWatchlist();
  if (stored.length > 0) {
    return stored;
  }
  return DEFAULT_WATCHLIST.map((entry) => ({
    ...entry,
    addedAt: new Date(0).toISOString(),
  }));
}

async function evaluateSymbol(
  symbol: string,
  exchange: string,
): Promise<{ alerts: AlertPayload[]; skipped: string[] }> {
  const alerts: AlertPayload[] = [];
  const skipped: string[] = [];

  const series = await fetchDailyOhlc(symbol);
  if (!series.bars.length) {
    throw new MarketDataError(`Empty OHLC data for ${symbol}`);
  }

  const sentiment = await fetchNewsSentiment(symbol);
  const snapshot = buildMarketSnapshot(series, exchange, sentiment);

  if (isSharpDip(snapshot)) {
    if (await wasAlertedRecently(symbol, "dip")) {
      skipped.push(`${symbol}:dip`);
    } else {
      alerts.push(createDipAlert(snapshot));
    }
  }

  if (isPromisingBreakout(snapshot)) {
    if (await wasAlertedRecently(symbol, "breakout")) {
      skipped.push(`${symbol}:breakout`);
    } else {
      alerts.push(createBreakoutAlert(snapshot));
    }
  }

  return { alerts, skipped };
}

/**
 * Vercel Cron entrypoint — scans the watchlist for dip / breakout anomalies
 * and posts Discord embeds, suppressing re-sends for 24 hours via Upstash.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: ScanResult = {
    scanned: 0,
    alerted: [],
    skipped: [],
    errors: [],
  };

  try {
    const watchlist = await resolveWatchlist();
    result.scanned = watchlist.length;

    for (const entry of watchlist) {
      try {
        const { alerts, skipped } = await evaluateSymbol(
          entry.symbol,
          entry.exchange,
        );
        result.skipped.push(...skipped);

        for (const alert of alerts) {
          await sendDiscordAlert(alert);
          await markAlertSent(alert.snapshot.symbol, alert.type);
          result.alerted.push(`${alert.snapshot.symbol}:${alert.type}`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown scan error";
        console.error(`[cron/scan] ${entry.symbol}:`, message);
        result.errors.push({ symbol: entry.symbol, message });
      }
    }

    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cron scan failed";
    console.error("[cron/scan] fatal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
