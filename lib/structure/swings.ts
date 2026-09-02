import type { OhlcBar } from "../../types/index.ts";

/** Local swing high indices (fractal). */
export function findSwingHighIndices(
  bars: OhlcBar[],
  left = 3,
  right = 3,
): number[] {
  const out: number[] = [];
  for (let i = left; i < bars.length - right; i += 1) {
    const high = bars[i]!.high;
    let isSwing = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (bars[j]!.high >= high) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) out.push(i);
  }
  return out;
}

/** Local swing low indices (fractal). */
export function findSwingLowIndices(
  bars: OhlcBar[],
  left = 3,
  right = 3,
): number[] {
  const out: number[] = [];
  for (let i = left; i < bars.length - right; i += 1) {
    const low = bars[i]!.low;
    let isSwing = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (bars[j]!.low <= low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) out.push(i);
  }
  return out;
}

export function isBearish(bar: OhlcBar): boolean {
  return bar.close < bar.open;
}

export function isBullish(bar: OhlcBar): boolean {
  return bar.close > bar.open;
}

export function bodySize(bar: OhlcBar): number {
  return Math.abs(bar.close - bar.open);
}
