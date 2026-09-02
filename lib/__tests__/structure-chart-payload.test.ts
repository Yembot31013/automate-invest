import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStructureChartPayload,
  isStructureChartPayload,
} from "../structure/chart-payload.ts";
import type { BullishStructureSetup } from "../structure/types.ts";

describe("structure chart payload", () => {
  it("builds slim candles and levels for the chat chart", () => {
    const setup: BullishStructureSetup = {
      symbol: "NZD/USD",
      timeframe: "2H",
      phase: "in_zone",
      bosPrice: 0.5906,
      swingHighPrice: 0.5898,
      fvgLow: 0.59,
      fvgHigh: 0.5902,
      obLow: 0.5894,
      obHigh: 0.59,
      stopLoss: 0.5889,
      takeProfit: 0.5925,
      riskReward: 2,
      currentPrice: 0.5897,
      setupBarTime: 1_700_000_000,
      reason: "test",
    };
    const bars = Array.from({ length: 40 }, (_, i) => ({
      timestamp: 1_700_000_000 + i * 7200,
      open: 0.589 + i * 0.0001,
      high: 0.591 + i * 0.0001,
      low: 0.588 + i * 0.0001,
      close: 0.59 + i * 0.0001,
      volume: 0,
    }));

    const chart = buildStructureChartPayload("NZD/USD", bars, setup);
    assert.equal(chart.symbol, "NZD/USD");
    assert.equal(chart.bars.length <= 72, true);
    assert.equal(chart.levels.obLow, 0.5894);
    assert.ok(chart.bosBarIndex >= 0);
    assert.ok(isStructureChartPayload(chart));
  });
});
