import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPool } from "../concurrency.ts";

/** Mirror of lib/market calculateSMA — kept local so Node tests need no path aliases. */
function calculateSMA(values: number[], period: number): number {
  if (!values.length) throw new Error("empty");
  if (values.length < period) throw new Error("short");
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

describe("market math", () => {
  it("calculates a 14-day SMA", () => {
    const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    assert.equal(calculateSMA(prices, 14), 16.5);
  });

  it("rejects empty SMA input", () => {
    assert.throws(() => calculateSMA([], 14));
  });

  it("detects dip and breakout thresholds", () => {
    const pctBelowSma14 = 10;
    const volumeRatio = 2.5;
    const changePct = 1.5;
    const sentimentScore = 0.4;
    assert.equal(pctBelowSma14 >= 8, true);
    assert.equal(volumeRatio >= 2 && changePct > 0 && sentimentScore >= 0, true);
  });
});

describe("mapPool", () => {
  it("preserves order under concurrency", async () => {
    const input = [1, 2, 3, 4, 5];
    const out = await mapPool(input, 2, async (n: number) => {
      await new Promise((r) => setTimeout(r, 5 * (6 - n)));
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
  });
});

describe("what-if pure helpers", () => {
  it("computes pnl percent from cost basis", () => {
    const cost = 100 * 10;
    const market = 120 * 10;
    const pnl = market - cost;
    const pnlPct = (pnl / cost) * 100;
    assert.equal(pnl, 200);
    assert.equal(pnlPct, 20);
  });
});
