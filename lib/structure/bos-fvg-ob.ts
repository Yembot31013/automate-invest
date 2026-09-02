import type { OhlcBar } from "../../types/index.ts";

import {
  bodySize,
  findSwingHighIndices,
  findSwingLowIndices,
  isBearish,
  isBullish,
} from "./swings.ts";
import type {
  BullishStructureSetup,
  StructurePhase,
  StructureScanResult,
  StructureTimeframe,
} from "./types.ts";

export const DEFAULT_STRUCTURE_TIMEFRAME: StructureTimeframe = "2H";
export const SWING_LEFT = 3;
export const SWING_RIGHT = 3;
/** Min body-close break above swing high (%). */
export const MIN_BOS_BREAK_PCT = 0.03;
/** Min FVG gap height as % of price. */
export const MIN_FVG_PCT = 0.02;
/** Min displacement body vs recent average. */
export const MIN_DISPLACEMENT_RATIO = 1.2;
/** Min risk:reward to surface a setup. */
export const MIN_RISK_REWARD = 1.5;

export function resampleBars(bars: OhlcBar[], groupSize: number): OhlcBar[] {
  if (groupSize <= 1) return [...bars];
  const out: OhlcBar[] = [];
  for (let i = 0; i + groupSize <= bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    out.push({
      timestamp: first.timestamp,
      open: first.open,
      high: Math.max(...chunk.map((b) => b.high)),
      low: Math.min(...chunk.map((b) => b.low)),
      close: last.close,
      volume: chunk.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  return out;
}

/** Bullish FVG: candle 3 low above candle 1 high. */
export function findBullishFvgAt(
  bars: OhlcBar[],
  startIndex: number,
): { low: number; high: number } | null {
  if (startIndex + 2 >= bars.length || startIndex < 0) return null;
  const gapLow = bars[startIndex]!.high;
  const gapHigh = bars[startIndex + 2]!.low;
  if (gapHigh > gapLow) {
    return { low: gapLow, high: gapHigh };
  }
  return null;
}

function avgBody(bars: OhlcBar[], endIndex: number, lookback = 14): number {
  const start = Math.max(0, endIndex - lookback + 1);
  const slice = bars.slice(start, endIndex + 1);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, b) => sum + bodySize(b), 0) / slice.length;
}

function priceTouchesZone(
  bar: OhlcBar,
  low: number,
  high: number,
): boolean {
  return bar.low <= high && bar.high >= low;
}

function resolvePhase(params: {
  bars: OhlcBar[];
  obLow: number;
  obHigh: number;
  stopLoss: number;
}): StructurePhase {
  const last = params.bars[params.bars.length - 1]!;
  const price = last.close;
  if (price < params.stopLoss) return "invalidated";
  if (priceTouchesZone(last, params.obLow, params.obHigh)) {
    return "in_zone";
  }
  if (price > params.obHigh) return "waiting_retrace";
  if (price >= params.stopLoss && price < params.obLow) {
    return "in_zone";
  }
  return "invalidated";
}

function pickTakeProfit(params: {
  bars: OhlcBar[];
  swingHighs: number[];
  bosIndex: number;
  swingHighIdx: number;
  entry: number;
  stopLoss: number;
}): number {
  const { bars, swingHighs, bosIndex, swingHighIdx, entry, stopLoss } = params;
  const minTp = entry + 2 * (entry - stopLoss);
  const candidates = swingHighs
    .filter((idx) => idx > swingHighIdx && bars[idx]!.high > entry)
    .map((idx) => bars[idx]!.high);
  if (candidates.length === 0) return minTp;
  const nearest = Math.min(...candidates.filter((h) => h >= minTp));
  return Number.isFinite(nearest) ? nearest : Math.max(...candidates, minTp);
}

/**
 * Scan closed 2H bars for the most recent valid bullish structure setup.
 * Does not predict — only returns setups where BOS + FVG + OB already formed.
 */
export function detectBullishStructure(
  symbol: string,
  bars: OhlcBar[],
  timeframe: StructureTimeframe = DEFAULT_STRUCTURE_TIMEFRAME,
): StructureScanResult {
  if (bars.length < 40) {
    return { setup: null, barCount: bars.length };
  }

  const swingHighs = findSwingHighIndices(bars, SWING_LEFT, SWING_RIGHT);
  if (swingHighs.length === 0) {
    return { setup: null, barCount: bars.length };
  }

  const lastIndex = bars.length - 1;
  const currentPrice = bars[lastIndex]!.close;
  const searchFrom = Math.max(15, lastIndex - 60);

  for (let bosIndex = lastIndex - 1; bosIndex >= searchFrom; bosIndex -= 1) {
    const bosBar = bars[bosIndex]!;

    for (let s = swingHighs.length - 1; s >= 0; s -= 1) {
      const swingIdx = swingHighs[s]!;
      if (swingIdx >= bosIndex - 1) continue;

      const swingHigh = bars[swingIdx]!.high;
      if (bosBar.close <= swingHigh) continue;

      const breakPct = ((bosBar.close - swingHigh) / swingHigh) * 100;
      if (breakPct < MIN_BOS_BREAK_PCT) continue;

      let dispIndex = bosIndex;
      if (!isBullish(bosBar)) {
        if (bosIndex + 1 < bars.length && isBullish(bars[bosIndex + 1]!)) {
          dispIndex = bosIndex + 1;
        } else {
          continue;
        }
      }

      const avg = avgBody(bars, dispIndex - 1);
      if (avg > 0 && bodySize(bars[dispIndex]!) < avg * MIN_DISPLACEMENT_RATIO) {
        continue;
      }

      let fvg: { low: number; high: number } | null = null;
      for (let f = Math.max(0, dispIndex - 2); f <= dispIndex; f += 1) {
        const found = findBullishFvgAt(bars, f);
        if (!found) continue;
        const fvgPct = ((found.high - found.low) / currentPrice) * 100;
        if (fvgPct >= MIN_FVG_PCT) {
          fvg = found;
          break;
        }
      }
      if (!fvg) continue;

      let obIndex = -1;
      for (let k = dispIndex - 1; k >= swingIdx; k -= 1) {
        if (isBearish(bars[k]!)) {
          obIndex = k;
          break;
        }
      }
      if (obIndex < 0) continue;

      const obBar = bars[obIndex]!;
      const obLow = obBar.low;
      const obHigh = obBar.high;

      const swingLows = findSwingLowIndices(
        bars.slice(0, bosIndex + 1),
        SWING_LEFT,
        SWING_RIGHT,
      );
      let stopLoss = obLow;
      for (const slIdx of swingLows) {
        if (slIdx <= obIndex) {
          stopLoss = Math.min(stopLoss, bars[slIdx]!.low);
        }
      }
      stopLoss = stopLoss * 0.999;

      const entry = (obLow + obHigh) / 2;
      const takeProfit = pickTakeProfit({
        bars,
        swingHighs,
        bosIndex,
        swingHighIdx: swingIdx,
        entry,
        stopLoss,
      });

      const risk = entry - stopLoss;
      const reward = takeProfit - entry;
      const riskReward = risk > 0 ? reward / risk : 0;
      if (riskReward < MIN_RISK_REWARD) continue;

      const phase = resolvePhase({ bars, obLow, obHigh, stopLoss });
      if (phase === "invalidated") continue;

      const setup: BullishStructureSetup = {
        symbol: symbol.toUpperCase(),
        timeframe,
        phase,
        bosPrice: bosBar.close,
        swingHighPrice: swingHigh,
        fvgLow: fvg.low,
        fvgHigh: fvg.high,
        obLow,
        obHigh,
        stopLoss,
        takeProfit,
        riskReward: Number(riskReward.toFixed(2)),
        currentPrice,
        setupBarTime: bosBar.timestamp,
        reason: `BOS close above ${swingHigh.toFixed(5)}, bullish FVG, order block ${obLow.toFixed(5)}–${obHigh.toFixed(5)}.`,
      };

      return { setup, barCount: bars.length };
    }
  }

  return { setup: null, barCount: bars.length };
}

export function formatStructureSetup(setup: BullishStructureSetup): string {
  const status =
    setup.phase === "in_zone"
      ? "Entry zone active"
      : "Waiting for retracement";
  return [
    `🟢 BULLISH SETUP · ${setup.symbol} · ${setup.timeframe}`,
    `Status: ${status}`,
    `BOS: ${setup.bosPrice.toFixed(5)} (swing ${setup.swingHighPrice.toFixed(5)})`,
    `Bullish FVG: ${setup.fvgLow.toFixed(5)} – ${setup.fvgHigh.toFixed(5)}`,
    `Entry / Order block: ${setup.obLow.toFixed(5)} – ${setup.obHigh.toFixed(5)}`,
    `Current: ${setup.currentPrice.toFixed(5)}`,
    `SL: ${setup.stopLoss.toFixed(5)} · TP: ${setup.takeProfit.toFixed(5)} · RR: 1:${setup.riskReward}`,
    setup.reason,
  ].join("\n");
}
