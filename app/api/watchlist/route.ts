import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { MarketDataError, verifyTradableSymbol } from "@/lib/market";
import {
  addToUserWatchlist,
  getUserWatchlist,
  removeFromUserWatchlist,
} from "@/lib/redis";
import {
  defaultExchangeForSymbol,
  findWatchlistSymbol,
  resolveSymbolInput,
} from "@/lib/symbols";
import type { WatchlistMutationBody } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseBody(raw: unknown): WatchlistMutationBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const body = raw as Record<string, unknown>;
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  if (!symbol) {
    throw new Error("Field 'symbol' is required");
  }

  const exchange =
    typeof body.exchange === "string" && body.exchange.trim()
      ? body.exchange.trim()
      : undefined;

  const action =
    body.action === "add" || body.action === "remove" ? body.action : undefined;

  return { symbol, exchange, action };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const watchlist = await getUserWatchlist(userId);
    return NextResponse.json({ watchlist });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load watchlist";
    console.error("[watchlist] GET:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = parseBody(await request.json());
    const symbol = await verifyTradableSymbol(body.symbol);
    const watchlist = await addToUserWatchlist(
      userId,
      symbol,
      body.exchange ?? defaultExchangeForSymbol(symbol),
    );
    return NextResponse.json({ ok: true, symbol, watchlist }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add symbol";
    console.error("[watchlist] POST:", message);
    const status =
      error instanceof MarketDataError ||
      message.includes("required") ||
      message.includes("No live quote") ||
      message.includes("Could not verify")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const querySymbol = searchParams.get("symbol");

    let symbol = querySymbol?.trim() ?? "";
    if (!symbol) {
      const body = parseBody(await request.json().catch(() => ({})));
      symbol = body.symbol;
    }

    if (!symbol) {
      return NextResponse.json(
        { error: "Field 'symbol' is required" },
        { status: 400 },
      );
    }

    const current = await getUserWatchlist(userId);
    const matched =
      findWatchlistSymbol(current, symbol) ??
      resolveSymbolInput(symbol).symbol ??
      symbol.trim().toUpperCase();
    const watchlist = await removeFromUserWatchlist(userId, matched);
    return NextResponse.json({ ok: true, symbol: matched, watchlist });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove symbol";
    console.error("[watchlist] DELETE:", message);
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
