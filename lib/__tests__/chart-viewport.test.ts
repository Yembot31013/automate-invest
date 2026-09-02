import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { StructureChartPayload } from "../structure/chart-payload.ts";
import {
  buildZoneSpecs,
  fullTradeViewport,
  setupViewport,
  slTpOffChart,
} from "../structure/chart-viewport.ts";

const sampleChart: StructureChartPayload = {
  symbol: "NZD/USD",
  timeframe: "2H",
  phase: "waiting_retrace",
  bosBarIndex: 2,
  bars: [
    { t: 1, o: 0.59, h: 0.591, l: 0.589, c: 0.5905 },
    { t: 2, o: 0.5905, h: 0.592, l: 0.59, c: 0.5915 },
    { t: 3, o: 0.5915, h: 0.5925, l: 0.591, c: 0.5922 },
    { t: 4, o: 0.5922, h: 0.5928, l: 0.589, c: 0.5895 },
  ],
  levels: {
    bosPrice: 0.59235,
    swingHighPrice: 0.591,
    fvgLow: 0.59182,
    fvgHigh: 0.59217,
    obLow: 0.59172,
    obHigh: 0.59182,
    stopLoss: 0.56231,
    takeProfit: 0.65069,
    currentPrice: 0.58903,
    riskReward: 2,
  },
};

describe("chart-viewport", () => {
  it("flags distant SL/TP as off setup zoom", () => {
    const view = setupViewport(sampleChart.bars, sampleChart.levels);
    assert.equal(slTpOffChart(sampleChart.levels, view), true);
  });

  it("full trade viewport spans SL to TP", () => {
    const view = fullTradeViewport(sampleChart.levels);
    assert.ok(view.min < sampleChart.levels.stopLoss);
    assert.ok(view.max > sampleChart.levels.takeProfit);
  });

  it("full trade mode always includes RR zones", () => {
    const zones = buildZoneSpecs(sampleChart, "full");
    assert.equal(zones.length, 4);
  });

  it("setup mode skips RR zones when SL/TP are far", () => {
    const zones = buildZoneSpecs(sampleChart, "setup");
    assert.equal(zones.length, 2);
  });
});
