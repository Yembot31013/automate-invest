import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getTradeHistory } from "@/lib/trade-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const limit =
      limitRaw != null ? Number.parseInt(limitRaw, 10) : undefined;
    const symbol = searchParams.get("symbol")?.trim() || undefined;

    const history = await getTradeHistory({
      userId,
      limit: Number.isFinite(limit) ? limit : undefined,
      symbol,
    });

    return NextResponse.json({ ok: true, ...history });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load trade history";
    logger.error("api/desk/history", message, { userId });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
