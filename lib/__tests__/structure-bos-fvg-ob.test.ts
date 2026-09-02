import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OhlcBar } from "../../types/index.ts";
import {
  detectBullishStructure,
  findBullishFvgAt,
  resampleBars,
} from "../structure/bos-fvg-ob.ts";
import { findSwingHighIndices } from "../structure/swings.ts";

function bar(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
): OhlcBar {
  return {
    timestamp: 1_700_000_000 + index * 7200,
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

function buildSyntheticSetupSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < 50; i += 1) {
    bars.push(bar(i, 1.088, 1.089, 1.087, 1.0885));
  }

  for (let i = 17; i <= 23; i += 1) {
    const dist = Math.abs(i - 20);
    const high = 1.1 - dist * 0.0015;
    bars[i] = bar(i, high - 0.001, high, high - 0.002, high - 0.0005);
  }
  bars[20] = bar(20, 1.099, 1.1, 1.098, 1.0995);

  for (let i = 24; i <= 36; i += 1) {
    bars[i] = bar(i, 1.091, 1.092, 1.089, 1.09);
  }

  bars[37] = bar(37, 1.09, 1.09, 1.089, 1.0895);
  bars[38] = bar(38, 1.0905, 1.0915, 1.0895, 1.0898);
  bars[39] = bar(39, 1.09, 1.092, 1.0905, 1.091);
  bars[40] = bar(40, 1.091, 1.103, 1.09, 1.1015);

  for (let i = 41; i <= 47; i += 1) {
    bars[i] = bar(i, 1.102, 1.105, 1.101, 1.103);
  }
  bars[48] = bar(48, 1.103, 1.104, 1.09, 1.091);
  bars[49] = bar(49, 1.091, 1.092, 1.09, 1.0908);

  return bars;
}

describe("structure resample", () => {
  it("merges hourly bars into 2H candles", () => {
    const hourly = [
      bar(0, 1, 1.1, 0.9, 1.05),
      bar(1, 1.05, 1.2, 1, 1.15),
      bar(2, 1.15, 1.25, 1.1, 1.2),
      bar(3, 1.2, 1.3, 1.15, 1.25),
    ];
    const twoH = resampleBars(hourly, 2);
    assert.equal(twoH.length, 2);
    assert.equal(twoH[0]!.open, 1);
    assert.equal(twoH[0]!.close, 1.15);
    assert.equal(twoH[0]!.high, 1.2);
    assert.equal(twoH[0]!.low, 0.9);
  });
});

describe("bullish FVG", () => {
  it("detects gap between candle 1 high and candle 3 low", () => {
    const bars = [
      bar(0, 1, 1.01, 0.99, 1),
      bar(1, 1, 1.02, 0.98, 1.01),
      bar(2, 1.015, 1.03, 1.012, 1.02),
    ];
    const fvg = findBullishFvgAt(bars, 0);
    assert.ok(fvg);
    assert.equal(fvg!.low, 1.01);
    assert.equal(fvg!.high, 1.012);
  });
});

describe("detectBullishStructure", () => {
  it("finds BOS + FVG + OB when price is in the order block", () => {
    const bars = buildSyntheticSetupSeries();
    const swingHighs = findSwingHighIndices(bars, 3, 3);
    assert.ok(swingHighs.includes(20));

    const result = detectBullishStructure("EUR/USD", bars);
    assert.ok(result.setup, "expected a bullish structure setup");
    assert.equal(result.setup!.phase, "in_zone");
    assert.equal(result.setup!.symbol, "EUR/USD");
    assert.ok(result.setup!.bosPrice > result.setup!.swingHighPrice);
    assert.ok(result.setup!.obLow <= result.setup!.currentPrice);
    assert.ok(result.setup!.currentPrice <= result.setup!.obHigh);
    assert.ok(result.setup!.riskReward >= 1.5);
  });

  it("returns null when bar count is too low", () => {
    const bars = [bar(0, 1, 1.01, 0.99, 1)];
    const result = detectBullishStructure("EUR/USD", bars);
    assert.equal(result.setup, null);
  });
});
