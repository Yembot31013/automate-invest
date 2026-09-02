import type { StructureChartPayload } from "./chart-payload";
import type { LwcZoneSpec } from "./lwc-setup-overlay";

/** Zone fills — kept here so viewport logic is testable without lightweight-charts. */
const ZONE = {
  profit: "rgba(38, 166, 154, 0.28)",
  loss: "rgba(239, 83, 80, 0.28)",
  profitCompact: "rgba(38, 166, 154, 0.22)",
  lossCompact: "rgba(239, 83, 80, 0.22)",
  orderBlock: "rgba(156, 120, 255, 0.38)",
  fvg: "rgba(38, 166, 154, 0.18)",
} as const;

export type ChartZoomMode = "setup" | "full";

export type PriceViewport = {
  min: number;
  max: number;
  span: number;
};

type Ut = import("lightweight-charts").UTCTimestamp;

export function entryPrice(levels: StructureChartPayload["levels"]): number {
  return (levels.obLow + levels.obHigh) / 2;
}

export function setupViewport(
  bars: StructureChartPayload["bars"],
  levels: StructureChartPayload["levels"],
): PriceViewport {
  const coreMin = Math.min(
    ...bars.map((b) => b.l),
    levels.obLow,
    levels.fvgLow,
    levels.currentPrice,
  );
  const coreMax = Math.max(
    ...bars.map((b) => b.h),
    levels.bosPrice,
    levels.fvgHigh,
    levels.obHigh,
    levels.currentPrice,
  );
  const span = coreMax - coreMin || levels.currentPrice * 0.001;
  const pad = span * 0.12;
  return { min: coreMin - pad, max: coreMax + pad, span };
}

export function fullTradeViewport(
  levels: StructureChartPayload["levels"],
): PriceViewport {
  const span = levels.takeProfit - levels.stopLoss || levels.currentPrice * 0.001;
  const pad = span * 0.06;
  return {
    min: levels.stopLoss - pad,
    max: levels.takeProfit + pad,
    span,
  };
}

export function levelInViewport(price: number, view: PriceViewport): boolean {
  return price >= view.min && price <= view.max;
}

export function slTpOffChart(
  levels: StructureChartPayload["levels"],
  view: PriceViewport,
): boolean {
  return (
    !levelInViewport(levels.stopLoss, view) ||
    !levelInViewport(levels.takeProfit, view)
  );
}

export function canExpandFullTradeAxis(
  bars: StructureChartPayload["bars"],
  levels: StructureChartPayload["levels"],
): boolean {
  const setup = setupViewport(bars, levels);
  const rrSpan = levels.takeProfit - levels.stopLoss;
  return rrSpan <= setup.span * 4;
}

export function usesCompactRrStrip(
  bars: StructureChartPayload["bars"],
  levels: StructureChartPayload["levels"],
  mode: ChartZoomMode,
): boolean {
  return mode === "full" && !canExpandFullTradeAxis(bars, levels);
}

function structureZones(
  obTime: Ut,
  lastTime: Ut,
  levels: StructureChartPayload["levels"],
): LwcZoneSpec[] {
  return [
    {
      p1: { time: obTime, price: levels.fvgLow },
      p2: { time: lastTime, price: levels.fvgHigh },
      fillColor: ZONE.fvg,
      extendRight: true,
    },
    {
      p1: { time: obTime, price: levels.obLow },
      p2: { time: lastTime, price: levels.obHigh },
      fillColor: ZONE.orderBlock,
      extendRight: true,
    },
  ];
}

function fullRrZones(
  bosTime: Ut,
  lastTime: Ut,
  entry: number,
  levels: StructureChartPayload["levels"],
): LwcZoneSpec[] {
  return [
    {
      p1: { time: bosTime, price: entry },
      p2: { time: lastTime, price: levels.takeProfit },
      fillColor: ZONE.profit,
      extendRight: true,
    },
    {
      p1: { time: bosTime, price: levels.stopLoss },
      p2: { time: lastTime, price: entry },
      fillColor: ZONE.loss,
      extendRight: true,
    },
  ];
}

/** Short green/red strips near entry when real SL/TP are off-screen (TV-style hint). */
function compactRrZones(
  bosTime: Ut,
  lastTime: Ut,
  entry: number,
  view: PriceViewport,
): LwcZoneSpec[] {
  const strip = view.span * 0.36;
  return [
    {
      p1: { time: bosTime, price: entry },
      p2: { time: lastTime, price: entry + strip },
      fillColor: ZONE.profitCompact,
      extendRight: true,
    },
    {
      p1: { time: bosTime, price: entry - strip },
      p2: { time: lastTime, price: entry },
      fillColor: ZONE.lossCompact,
      extendRight: true,
    },
  ];
}

export function buildZoneSpecs(
  chart: StructureChartPayload,
  mode: ChartZoomMode,
): LwcZoneSpec[] {
  const { bars, levels, bosBarIndex } = chart;
  const bosBar = bars[bosBarIndex] ?? bars[0]!;
  const lastBar = bars[bars.length - 1]!;
  const obBar = bars[Math.max(0, bosBarIndex - 1)] ?? bosBar;
  const entry = entryPrice(levels);
  const bosTime = bosBar.t as Ut;
  const lastTime = lastBar.t as Ut;
  const obTime = obBar.t as Ut;
  const setup = setupViewport(bars, levels);
  const zones = structureZones(obTime, lastTime, levels);

  if (mode === "full") {
    if (usesCompactRrStrip(bars, levels, mode)) {
      return [...compactRrZones(bosTime, lastTime, entry, setup), ...zones];
    }
    return [...fullRrZones(bosTime, lastTime, entry, levels), ...zones];
  }

  const rrSpan = levels.takeProfit - levels.stopLoss;
  const showRiskReward =
    rrSpan <= setup.span * 3.2 &&
    levelInViewport(levels.stopLoss, setup) &&
    levelInViewport(levels.takeProfit, setup);

  return showRiskReward
    ? [...fullRrZones(bosTime, lastTime, entry, levels), ...zones]
    : zones;
}

export function autoscaleForMode(
  mode: ChartZoomMode,
  bars: StructureChartPayload["bars"],
  levels: StructureChartPayload["levels"],
): { min: number; max: number } | null {
  if (mode !== "full") return null;
  if (!canExpandFullTradeAxis(bars, levels)) return null;
  const view = fullTradeViewport(levels);
  return { min: view.min, max: view.max };
}
