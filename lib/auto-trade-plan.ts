import type { DeskSettings } from "./desk-settings";

export type AutoTradeAlertLite = {
  type: "dip" | "breakout";
  snapshot: { symbol: string; currentPrice: number };
};

export type AutoTradeAction =
  | {
      type: "exit";
      symbol: string;
      reason: "stop" | "trail";
      pnlPct: number;
    }
  | {
      type: "entry";
      symbol: string;
      quantity: number;
      reason: "dip";
    }
  | {
      type: "attention";
      symbol: string;
      reason: string;
    };

export function peakPctFromNotes(notes: string | undefined): number | null {
  if (!notes) return null;
  const match = notes.match(/autoPeakPct:(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function withPeakPct(notes: string | undefined, peak: number): string {
  const tag = `autoPeakPct:${peak.toFixed(2)}`;
  if (!notes?.trim()) return tag;
  if (/autoPeakPct:/.test(notes)) {
    return notes.replace(/autoPeakPct:-?\d+(?:\.\d+)?/, tag);
  }
  return `${notes} | ${tag}`;
}

/**
 * Decide exit/entry for one user against a scan alert.
 * Exits: owned positions only. Entries: watchlist only.
 */
export function planAutoTradeForAlert(params: {
  settings: DeskSettings;
  alert: AutoTradeAlertLite;
  openPositions: Array<{
    id: string;
    symbol: string;
    unrealizedPnlPct: number;
    notes?: string;
  }>;
  onWatchlist: boolean;
  buysToday: number;
  cash: number;
}): AutoTradeAction[] {
  const { settings, alert, openPositions, onWatchlist, buysToday, cash } =
    params;
  if (!settings.autoTradeEnabled) return [];

  const actions: AutoTradeAction[] = [];
  const symbol = alert.snapshot.symbol;

  const owned = openPositions.filter(
    (p) =>
      p.symbol === symbol ||
      p.symbol.replaceAll("/", "") === symbol.replaceAll("/", ""),
  );

  for (const pos of owned) {
    const pnl = pos.unrealizedPnlPct;
    if (pnl <= -settings.stopLossPct) {
      actions.push({
        type: "exit",
        symbol: pos.symbol,
        reason: "stop",
        pnlPct: pnl,
      });
      continue;
    }
    if (pnl >= settings.takeProfitPct) {
      const peak = Math.max(peakPctFromNotes(pos.notes) ?? pnl, pnl);
      const giveback = peak - pnl;
      if (giveback >= settings.trailGivebackPct) {
        actions.push({
          type: "exit",
          symbol: pos.symbol,
          reason: "trail",
          pnlPct: pnl,
        });
      } else {
        actions.push({
          type: "attention",
          symbol: pos.symbol,
          reason: `In profit (+${pnl.toFixed(1)}%, peak ~${peak.toFixed(1)}%) — trail giveback not hit yet`,
        });
      }
    }
  }

  if (
    alert.type === "dip" &&
    settings.allowAutoBuys &&
    onWatchlist &&
    owned.length === 0
  ) {
    if (buysToday >= settings.maxBuysPerDay) {
      actions.push({
        type: "attention",
        symbol,
        reason: `Dip on watchlist but daily auto-buy cap (${settings.maxBuysPerDay}) reached`,
      });
    } else {
      const price = alert.snapshot.currentPrice;
      if (price > 0 && cash > 50) {
        const notional = Math.min(settings.maxBuyNotionalUsd, cash * 0.2);
        const quantity = Math.floor((notional / price) * 10000) / 10000;
        if (quantity > 0) {
          actions.push({
            type: "entry",
            symbol,
            quantity,
            reason: "dip",
          });
        }
      }
    }
  }

  if (alert.type === "breakout" && owned.length === 0) {
    actions.push({
      type: "attention",
      symbol,
      reason: "Breakout on the board — Auto won't chase; check if you want in",
    });
  }

  return actions;
}
