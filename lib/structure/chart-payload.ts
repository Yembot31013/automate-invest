import type { OhlcBar } from "@/types";

import type { BullishStructureSetup } from "./types";

export type StructureChartCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

/** Slim payload for inline chat chart rendering. */
export type StructureChartPayload = {
  symbol: string;
  timeframe: string;
  phase: BullishStructureSetup["phase"];
  /** Index in `bars` where BOS confirmed (for marker). */
  bosBarIndex: number;
  bars: StructureChartCandle[];
  levels: {
    bosPrice: number;
    swingHighPrice: number;
    fvgLow: number;
    fvgHigh: number;
    obLow: number;
    obHigh: number;
    stopLoss: number;
    takeProfit: number;
    currentPrice: number;
    riskReward: number;
  };
};

const CHART_BAR_WINDOWS: Record<string, number> = {
  "1H": 96,
  "2H": 72,
  "4H": 60,
  "1D": 45,
};

const DEFAULT_CHART_WINDOW = 72;

function chartWindowForTimeframe(timeframe: string): number {
  return CHART_BAR_WINDOWS[timeframe.toUpperCase()] ?? DEFAULT_CHART_WINDOW;
}

function slimBar(b: OhlcBar): StructureChartCandle {
  return {
    t: b.timestamp,
    o: Number(b.open.toFixed(5)),
    h: Number(b.high.toFixed(5)),
    l: Number(b.low.toFixed(5)),
    c: Number(b.close.toFixed(5)),
  };
}

/** Keep enough history for TV-like context while centred on the setup. */
export function focusBarsAroundSetup(
  bars: OhlcBar[],
  setup: BullishStructureSetup,
  window = chartWindowForTimeframe(setup.timeframe),
): OhlcBar[] {
  let bosIndex = bars.findIndex((b) => b.timestamp === setup.setupBarTime);
  if (bosIndex < 0) bosIndex = Math.max(0, bars.length - 12);
  const before = Math.floor(window * 0.55);
  const start = Math.max(0, bosIndex - before);
  const end = Math.min(bars.length, start + window);
  return bars.slice(start, end);
}

export function buildStructureChartPayload(
  symbol: string,
  bars: OhlcBar[],
  setup: BullishStructureSetup,
): StructureChartPayload {
  const focused = focusBarsAroundSetup(bars, setup);
  let bosBarIndex = focused.findIndex(
    (b) => b.timestamp === setup.setupBarTime,
  );
  if (bosBarIndex < 0) {
    bosBarIndex = Math.max(0, focused.length - 4);
  }

  return {
    symbol: symbol.toUpperCase(),
    timeframe: setup.timeframe,
    phase: setup.phase,
    bosBarIndex,
    bars: focused.map(slimBar),
    levels: {
      bosPrice: Number(setup.bosPrice.toFixed(5)),
      swingHighPrice: Number(setup.swingHighPrice.toFixed(5)),
      fvgLow: Number(setup.fvgLow.toFixed(5)),
      fvgHigh: Number(setup.fvgHigh.toFixed(5)),
      obLow: Number(setup.obLow.toFixed(5)),
      obHigh: Number(setup.obHigh.toFixed(5)),
      stopLoss: Number(setup.stopLoss.toFixed(5)),
      takeProfit: Number(setup.takeProfit.toFixed(5)),
      currentPrice: Number(setup.currentPrice.toFixed(5)),
      riskReward: setup.riskReward,
    },
  };
}

export function isStructureChartPayload(
  value: unknown,
): value is StructureChartPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as StructureChartPayload;
  return (
    typeof v.symbol === "string" &&
    Array.isArray(v.bars) &&
    v.bars.length >= 2 &&
    typeof v.levels === "object" &&
    v.levels != null
  );
}
