import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { MarketDataError, fetchDailyOhlc } from "@/lib/market";
import { resolveSymbolInput } from "@/lib/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** OHLC series for desk charts (NGX Free may be quote-backed). */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbol")?.trim() ?? "";
  const exchangeHint = searchParams.get("exchange")?.trim() || undefined;
  if (!raw) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  try {
    const resolved = resolveSymbolInput(raw, exchangeHint);
    const series = await fetchDailyOhlc(
      resolved.symbol,
      90,
      exchangeHint ?? resolved.exchange,
    );
    const closes = series.bars.map((b) => b.close);
    const last = series.bars[series.bars.length - 1];
    return NextResponse.json({
      symbol: series.symbol,
      exchange: exchangeHint ?? resolved.exchange,
      bars: series.bars,
      closes,
      lastClose: last?.close ?? null,
      barCount: series.bars.length,
    });
  } catch (error) {
    const message =
      error instanceof MarketDataError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to load OHLC";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
