import type { StructureChartPayload } from "./chart-payload";
import type { LwcZoneSpec } from "./lwc-setup-overlay";

/** Zone fills — kept here so viewport logic is testable without lightweight-charts. */
const ZONE = {
  profit: "rgba(38, 166, 154, 0.28)",
  loss: "rgba(239, 83, 80, 0.28)",
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

export function setupViewport(
  bars: StructureChartPayload["bars"],
  levels: StructureChartPayload["levels"],
): PriceViewport {
  const coreMin = Math.min(
    ...bars.map((b) => b.l),
    levels.obLow,
    levels.fvgLow,
  );
  const coreMax = Math.max(
    ...bars.map((b) => b.h),
    levels.bosPrice,
    levels.fvgHigh,
    levels.obHigh,
  );
  const span = coreMax - coreMin || levels.currentPrice * 0.001;
  const pad = span * 0.14;
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

export function buildZoneSpecs(
  chart: StructureChartPayload,
  mode: ChartZoomMode,
): LwcZoneSpec[] {
  const { bars, levels, bosBarIndex } = chart;
  const bosBar = bars[bosBarIndex] ?? bars[0]!;
  const lastBar = bars[bars.length - 1]!;
  const obBar = bars[Math.max(0, bosBarIndex - 1)] ?? bosBar;
  const entry = (levels.obLow + levels.obHigh) / 2;
  const bosTime = bosBar.t as Ut;
  const lastTime = lastBar.t as Ut;
  const obTime = obBar.t as Ut;

  const structureZones: LwcZoneSpec[] = [
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

  const rrZones: LwcZoneSpec[] = [
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

  if (mode === "full") {
    return [...rrZones, ...structureZones];
  }

  const view = setupViewport(bars, levels);
  const rrSpan = levels.takeProfit - levels.stopLoss;
  const showRiskReward =
    rrSpan <= view.span * 3.2 &&
    levelInViewport(levels.stopLoss, view) &&
    levelInViewport(levels.takeProfit, view);

  return showRiskReward ? [...rrZones, ...structureZones] : structureZones;
}

export function autoscaleForMode(
  mode: ChartZoomMode,
  levels: StructureChartPayload["levels"],
): { min: number; max: number } | null {
  if (mode !== "full") return null;
  const view = fullTradeViewport(levels);
  return { min: view.min, max: view.max };
}
