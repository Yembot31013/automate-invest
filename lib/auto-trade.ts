import { getDeskSettings } from "@/lib/desk-settings-store";
import {
  peakPctFromNotes,
  planAutoTradeForAlert,
  withPeakPct,
  type AutoTradeAction,
} from "@/lib/auto-trade-plan";
import {
  autoEntryCopy,
  autoExitCopy,
  autoSkipCopy,
} from "@/lib/desk-event-copy";
import { appendDeskEvent, tapeFromSnapshot } from "@/lib/desk-events";
import { logger } from "@/lib/logger";
import {
  getAutoBuyCountToday,
  getPaperPositions,
  getUserWatchlist,
  incrementAutoBuyCountToday,
  savePaperPositions,
  withUserPaperLock,
} from "@/lib/redis";
import { getPortfolioSummary, paperBuy, paperSell } from "@/lib/paper";
import { findWatchlistSymbol } from "@/lib/symbols";
import type { AlertPayload } from "@/types";
import type { DeskSettings } from "@/lib/desk-settings";

export type { AutoTradeAction };
export { peakPctFromNotes, planAutoTradeForAlert, withPeakPct };

async function bumpPeaksForOpenWinners(
  userId: string,
  settings: DeskSettings,
  marks: Array<{ id: string; unrealizedPnlPct: number }>,
): Promise<void> {
  await withUserPaperLock(userId, async () => {
    const positions = await getPaperPositions(userId);
    let changed = false;
    const next = positions.map((p) => {
      if (p.status !== "open") return p;
      const mark = marks.find((m) => m.id === p.id);
      if (!mark || mark.unrealizedPnlPct < settings.takeProfitPct) return p;
      const prev = peakPctFromNotes(p.notes) ?? mark.unrealizedPnlPct;
      const peak = Math.max(prev, mark.unrealizedPnlPct);
      if (peakPctFromNotes(p.notes) != null && peak <= prev + 1e-9) return p;
      changed = true;
      return { ...p, notes: withPeakPct(p.notes, peak) };
    });
    if (changed) await savePaperPositions(userId, next);
  });
}

export async function runAutoTradeForUserAlert(params: {
  userId: string;
  alert: AlertPayload;
}): Promise<{
  traded: boolean;
  attentionOnly: boolean;
  summaries: string[];
}> {
  const { userId, alert } = params;
  const settings = await getDeskSettings(userId);
  if (!settings.autoTradeEnabled) {
    return { traded: false, attentionOnly: false, summaries: [] };
  }

  const [portfolio, watchlist, buysToday] = await Promise.all([
    getPortfolioSummary(userId),
    getUserWatchlist(userId),
    getAutoBuyCountToday(userId),
  ]);

  await bumpPeaksForOpenWinners(
    userId,
    settings,
    portfolio.positions.map((p) => ({
      id: p.id,
      unrealizedPnlPct: p.unrealizedPnlPct,
    })),
  );

  const refreshed = await getPortfolioSummary(userId);
  const onWatchlist = Boolean(
    findWatchlistSymbol(watchlist, alert.snapshot.symbol),
  );

  const plan = planAutoTradeForAlert({
    settings,
    alert: {
      type: alert.type,
      snapshot: {
        symbol: alert.snapshot.symbol,
        currentPrice: alert.snapshot.currentPrice,
      },
    },
    openPositions: refreshed.positions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      unrealizedPnlPct: p.unrealizedPnlPct,
      notes: p.notes,
    })),
    onWatchlist,
    buysToday,
    cash: refreshed.cash,
  });

  const summaries: string[] = [];
  let traded = false;
  let attentionOnly = false;

  const alertTape = tapeFromSnapshot(alert.snapshot, {
    alertType: alert.type,
  });

  for (const action of plan) {
    try {
      if (action.type === "exit") {
        await paperSell({ userId, symbol: action.symbol });
        traded = true;
        const label = action.reason === "stop" ? "stop-loss" : "trail exit";
        const chip = autoExitCopy({
          symbol: action.symbol,
          reason: action.reason,
          pnlPct: action.pnlPct,
        });
        summaries.push(`${label}: sold ${action.symbol}`);
        await appendDeskEvent(userId, {
          kind: "auto-exit",
          text: chip.text,
          hint: chip.hint,
          symbol: action.symbol,
          tape: tapeFromSnapshot(alert.snapshot, {
            alertType: alert.type,
            pnlPct: action.pnlPct,
          }),
        });
      } else if (action.type === "entry") {
        await paperBuy({
          userId,
          symbol: action.symbol,
          quantity: action.quantity,
          notes: "auto-entry:dip",
        });
        await incrementAutoBuyCountToday(userId);
        traded = true;
        const chip = autoEntryCopy({
          symbol: action.symbol,
          quantity: action.quantity,
        });
        summaries.push(`Auto buy: ${action.quantity} ${action.symbol}`);
        await appendDeskEvent(userId, {
          kind: "auto-entry",
          text: chip.text,
          hint: chip.hint,
          symbol: action.symbol,
          tape: alertTape,
        });
      } else {
        attentionOnly = true;
        const chip = autoSkipCopy({
          symbol: action.symbol,
          reason: action.reason,
        });
        summaries.push(chip.text);
        await appendDeskEvent(userId, {
          kind: "auto-skip",
          text: chip.text,
          hint: chip.hint,
          symbol: action.symbol,
          tape: alertTape,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Auto-trade step failed";
      logger.error("auto-trade", message, {
        userId,
        symbol: alert.snapshot.symbol,
      });
      attentionOnly = true;
      const chip = autoSkipCopy({
        symbol: alert.snapshot.symbol,
        reason: message,
      });
      summaries.push(chip.text);
      await appendDeskEvent(userId, {
        kind: "auto-skip",
        text: chip.text,
        hint: chip.hint,
        symbol: alert.snapshot.symbol,
        tape: alertTape,
      });
    }
  }

  return { traded, attentionOnly, summaries };
}
