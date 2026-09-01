import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { MarketDataError, verifyTradableSymbolDetailed } from "@/lib/market";
import { MAX_USER_TRIGGERS } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { getDeskSettings } from "@/lib/desk-settings-store";
import { loadTriggerBookContext } from "@/lib/trigger-sync";
import {
  TriggerValidationError,
  validateTriggerCreate,
  validateTriggerEnable,
  validateTriggerUpdate,
} from "@/lib/trigger-validate";
import {
  createUserTrigger,
  listUserTriggers,
  removeUserTrigger,
  updateUserTrigger,
} from "@/lib/triggers-store";
import {
  normalizeAutoPauseAfterFire,
  normalizeNotionalUsd,
  normalizeTriggerAction,
  normalizeTriggerCondition,
  normalizeTriggerSellClose,
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

    const notionalUsd = normalizeNotionalUsd(body.notionalUsd);
    const sellClose = normalizeTriggerSellClose(
      action,
      body.sellCloseMode,
      body.sellCloseValue,
    );
    const [existing, book, settings] = await Promise.all([
      listUserTriggers(userId),
      loadTriggerBookContext(userId),
      getDeskSettings(userId),
    ]);
    const readiness = validateTriggerCreate({
      symbol: verified.symbol,
      condition,
      action,
      notionalUsd,
      sellCloseMode: sellClose.sellCloseMode,
      sellCloseValue: sellClose.sellCloseValue,
      existing,
      book,
      guardrails: settings,
    });
    if (!readiness.ok) {
      return NextResponse.json(
        { ok: false, error: readiness.error },
        { status: 400 },
      );
    }

    const trigger = await createUserTrigger(userId, {
      symbol: verified.symbol,
      exchange: verified.exchange,
      condition,
      action,
      notionalUsd,
      sellCloseMode: sellClose.sellCloseMode,
      sellCloseValue: sellClose.sellCloseValue,
      autoPauseAfterFire: normalizeAutoPauseAfterFire(
        body.autoPauseAfterFire,
        action,
      ),
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
      error instanceof TriggerValidationError ||
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

    const existing = await listUserTriggers(userId);
    const current = existing.find((t) => t.id === id);
    if (!current) {
      return NextResponse.json(
        { ok: false, error: "Trigger not found" },
        { status: 404 },
      );
    }

    const nextCondition =
      body.condition !== undefined
        ? normalizeTriggerCondition(body.condition)
        : current.condition;
    const nextAction =
      body.action !== undefined
        ? normalizeTriggerAction(body.action)
        : current.action;
    if (body.condition !== undefined && !nextCondition) {
      return NextResponse.json(
        { ok: false, error: TRIGGER_CONDITION_HINT },
        { status: 400 },
      );
    }
    if (body.action !== undefined && !nextAction) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid action — use attention, paper_buy, or paper_sell",
        },
        { status: 400 },
      );
    }

    const nextEnabled =
      typeof body.enabled === "boolean" ? body.enabled : current.enabled;
    const nextNotional =
      body.notionalUsd !== undefined
        ? normalizeNotionalUsd(body.notionalUsd)
        : current.notionalUsd;
    const nextAutoPause =
      body.autoPauseAfterFire !== undefined
        ? body.autoPauseAfterFire === true
        : current.autoPauseAfterFire;
    const nextSellClose = normalizeTriggerSellClose(
      nextAction!,
      body.sellCloseMode ?? current.sellCloseMode,
      body.sellCloseValue ?? current.sellCloseValue,
    );

    const book = await loadTriggerBookContext(userId);
    const settings = await getDeskSettings(userId);
    const readiness = validateTriggerUpdate({
      triggerId: id,
      symbol: current.symbol,
      condition: nextCondition!,
      action: nextAction!,
      notionalUsd: nextNotional,
      sellCloseMode: nextSellClose.sellCloseMode,
      sellCloseValue: nextSellClose.sellCloseValue,
      enabled: nextEnabled,
      existing,
      book,
      guardrails: settings,
    });
    if (!readiness.ok) {
      return NextResponse.json(
        { ok: false, error: readiness.error },
        { status: 400 },
      );
    }

    const onlyToggle =
      body.condition === undefined &&
      body.action === undefined &&
      body.notionalUsd === undefined &&
      body.sellCloseMode === undefined &&
      body.sellCloseValue === undefined &&
      body.autoPauseAfterFire === undefined &&
      typeof body.enabled === "boolean";

    if (onlyToggle && body.enabled === true) {
      const enableCheck = validateTriggerEnable({
        trigger: { ...current, enabled: true },
        existing,
        book,
        guardrails: settings,
      });
      if (!enableCheck.ok) {
        return NextResponse.json(
          { ok: false, error: enableCheck.error },
          { status: 400 },
        );
      }
    }

    const trigger = await updateUserTrigger(userId, id, {
      enabled: nextEnabled,
      condition: body.condition !== undefined ? nextCondition! : undefined,
      action: body.action !== undefined ? nextAction! : undefined,
      notionalUsd:
        body.notionalUsd !== undefined ? nextNotional : undefined,
      sellCloseMode:
        body.sellCloseMode !== undefined || body.sellCloseValue !== undefined
          ? nextSellClose.sellCloseMode
          : undefined,
      sellCloseValue:
        body.sellCloseMode !== undefined || body.sellCloseValue !== undefined
          ? nextSellClose.sellCloseValue
          : undefined,
      autoPauseAfterFire:
        body.autoPauseAfterFire !== undefined ? nextAutoPause : undefined,
    });
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
    const status =
      error instanceof TriggerValidationError ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
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
