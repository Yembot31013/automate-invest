import { NextResponse } from "next/server";

import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from "@/lib/redis";
import type { WatchlistMutationBody } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** List tracked assets. */
export async function GET() {
  try {
    const watchlist = await getWatchlist();
    return NextResponse.json({ watchlist });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load watchlist";
    console.error("[watchlist] GET:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Add a ticker.
 * Body: `{ "symbol": "NVDA", "exchange": "NASDAQ" }`
 */
export async function POST(request: Request) {
  try {
    const body = parseBody(await request.json());
    const watchlist = await addToWatchlist(body.symbol, body.exchange ?? "NASDAQ");
    return NextResponse.json({ ok: true, watchlist }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add symbol";
    console.error("[watchlist] POST:", message);
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Remove a ticker.
 * Body: `{ "symbol": "NVDA" }` or `{ "symbol": "NVDA", "action": "remove" }`
 * Also accepts `?symbol=NVDA`.
 */
export async function DELETE(request: Request) {
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

    const watchlist = await removeFromWatchlist(symbol);
    return NextResponse.json({ ok: true, watchlist });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove symbol";
    console.error("[watchlist] DELETE:", message);
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
