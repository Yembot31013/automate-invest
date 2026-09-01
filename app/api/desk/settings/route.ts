import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { appendDeskEvent } from "@/lib/desk-events";
import { autoDisabledCopy, autoEnabledCopy } from "@/lib/desk-event-copy";
import {
  AUTO_TRADE_QUIZ_VERSION,
  gradeAutoTradeQuiz,
  type QuizAnswers,
} from "@/lib/desk-settings";
import {
  disableAutoTrade,
  enableAutoTrade,
  getDeskSettings,
  saveDeskSettings,
} from "@/lib/desk-settings-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getDeskSettings(userId);
  return NextResponse.json({
    settings,
    quizVersion: AUTO_TRADE_QUIZ_VERSION,
  });
}

type PatchBody = {
  action?: "enable" | "disable" | "updateGuardrails";
  quizAnswers?: QuizAnswers;
  agreed?: boolean;
  guardrailsEnabled?: boolean;
  maxSymbolExposureUsd?: number;
  maxTriggerBuysPerDay?: number;
  maxTriggerSpendPerDayUsd?: number;
  pauseTriggerBuysWhenBookDownPct?: number;
};

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PatchBody;
    const action = body.action;

    if (action === "disable") {
      const settings = await disableAutoTrade(userId);
      const chip = autoDisabledCopy();
      await appendDeskEvent(userId, {
        kind: "auto-disabled",
        text: chip.text,
        hint: chip.hint,
      });
      return NextResponse.json({ ok: true, settings });
    }

    if (action === "updateGuardrails") {
      const current = await getDeskSettings(userId);
      const settings = await saveDeskSettings(userId, {
        ...current,
        guardrailsEnabled:
          typeof body.guardrailsEnabled === "boolean"
            ? body.guardrailsEnabled
            : current.guardrailsEnabled,
        maxSymbolExposureUsd:
          body.maxSymbolExposureUsd ?? current.maxSymbolExposureUsd,
        maxTriggerBuysPerDay:
          body.maxTriggerBuysPerDay ?? current.maxTriggerBuysPerDay,
        maxTriggerSpendPerDayUsd:
          body.maxTriggerSpendPerDayUsd ?? current.maxTriggerSpendPerDayUsd,
        pauseTriggerBuysWhenBookDownPct:
          body.pauseTriggerBuysWhenBookDownPct ??
          current.pauseTriggerBuysWhenBookDownPct,
      });
      return NextResponse.json({ ok: true, settings });
    }

    if (action === "enable") {
      if (!body.agreed) {
        return NextResponse.json(
          { ok: false, error: "You must agree to the Auto-trade terms." },
          { status: 400 },
        );
      }
      const grade = gradeAutoTradeQuiz(body.quizAnswers ?? {});
      if (!grade.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "Quiz not passed — check the answers and try again.",
            missing: grade.missing,
            wrong: grade.wrong,
          },
          { status: 400 },
        );
      }
      const settings = await enableAutoTrade(userId, AUTO_TRADE_QUIZ_VERSION);
      const chip = autoEnabledCopy();
      await appendDeskEvent(userId, {
        kind: "auto-enabled",
        text: chip.text,
        hint: `${chip.hint} · TP ${settings.takeProfitPct}% / stop ${settings.stopLossPct}% / trail ${settings.trailGivebackPct}%`,
      });
      return NextResponse.json({ ok: true, settings });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown action" },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Settings update failed";
    logger.error("api/desk/settings", message, { userId });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
