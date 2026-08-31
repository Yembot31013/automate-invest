import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { MarketDataError, verifyTradableSymbolDetailed } from "@/lib/market";
import { MAX_USER_TRIGGERS } from "@/lib/limits";
import { logger } from "@/lib/logger";
import {
  createUserTrigger,
  listUserTriggers,
  removeUserTrigger,
  setUserTriggerEnabled,
} from "@/lib/triggers-store";
import {
  normalizeNotionalUsd,
  normalizeTriggerAction,
  normalizeTriggerCondition,
  TRIGGER_CONDITION_HINT,
  TriggerLimitError,
} from "@/lib/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const triggers = await listUserTriggers(userId);
    return NextResponse.json({
      triggers,
      limit: MAX_USER_TRIGGERS,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load triggers";
    logger.error("api/triggers", message, { userId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const symbol =
      typeof body.symbol === "string" ? body.symbol.trim() : "";
    if (!symbol) {
      return NextResponse.json(
        { ok: false, error: "Field 'symbol' is required" },
        { status: 400 },
      );
    }
    const condition = normalizeTriggerCondition(body.condition);
    const action = normalizeTriggerAction(body.action);
    if (!condition) {
      return NextResponse.json(
        {
          ok: false,
          error: TRIGGER_CONDITION_HINT,
        },
        { status: 400 },
      );
    }
    if (!action) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid action — use attention, paper_buy, or paper_sell",
        },
        { status: 400 },
      );
    }

    const verified = await verifyTradableSymbolDetailed(
      symbol,
      typeof body.exchange === "string" ? body.exchange : undefined,
    );

    const trigger = await createUserTrigger(userId, {
      symbol: verified.symbol,
      exchange: verified.exchange,
      condition,
      action,
      notionalUsd: normalizeNotionalUsd(body.notionalUsd),
    });
    const triggers = await listUserTriggers(userId);
    return NextResponse.json(
      { ok: true, trigger, triggers, limit: MAX_USER_TRIGGERS },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create trigger";
    logger.error("api/triggers", message, { userId });
    const status =
      error instanceof MarketDataError ||
      error instanceof TriggerLimitError ||
      message.includes("required") ||
      message.includes("No live quote") ||
      message.includes("Could not verify") ||
      message.includes("Triggers are full")
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Field 'id' is required" },
        { status: 400 },
      );
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "Field 'enabled' (boolean) is required" },
        { status: 400 },
      );
    }

    const trigger = await setUserTriggerEnabled(userId, id, body.enabled);
    if (!trigger) {
      return NextResponse.json(
        { ok: false, error: "Trigger not found" },
        { status: 404 },
      );
    }
    const triggers = await listUserTriggers(userId);
    return NextResponse.json({ ok: true, trigger, triggers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update trigger";
    logger.error("api/triggers", message, { userId });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id")?.trim() ?? "";
    if (!id) {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      id = typeof body.id === "string" ? body.id.trim() : "";
    }
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Field 'id' is required" },
        { status: 400 },
      );
    }

    const { removed, triggers } = await removeUserTrigger(userId, id);
    if (!removed) {
      return NextResponse.json(
        { ok: false, error: "Trigger not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, removed, triggers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove trigger";
    logger.error("api/triggers", message, { userId });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
