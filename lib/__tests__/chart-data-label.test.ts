import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { structureChartDataWindow } from "../structure/chart-data-label.ts";

describe("structureChartDataWindow", () => {
  it("formats bar range from first to last bar open for 1H", () => {
    const base = 1_725_139_200; // 2024-09-01 00:00 UTC
    const bars = Array.from({ length: 3 }, (_, i) => ({ t: base + i * 3600 }));
    const win = structureChartDataWindow({ bars, timeframe: "1H" });
    assert.ok(win);
    assert.equal(win.barCount, 3);
    assert.equal(win.rangeFromUnix, base);
    assert.equal(win.priceAsOfUnix, base + 2 * 3600);
    assert.equal(win.rangeToUnix, base + 2 * 3600 + 3600);
    assert.match(win.rangeLabel, /UTC$/);
    assert.match(win.priceAsOfLabel, /UTC$/);
    assert.ok(!win.rangeLabel.includes("NaN"));
  });

  it("formats daily without clock times", () => {
    const base = 1_725_139_200;
    const bars = [
      { t: base },
      { t: base + 86400 },
      { t: base + 2 * 86400 },
    ];
    const win = structureChartDataWindow({ bars, timeframe: "1D" });
    assert.ok(win);
    assert.equal(win.priceAsOfUnix, base + 2 * 86400);
    assert.match(win.rangeLabel, /UTC$/);
    assert.ok(!/\d{2}:\d{2}/.test(win.rangeLabel));
  });

  it("returns null for empty bars", () => {
    assert.equal(structureChartDataWindow({ bars: [], timeframe: "2H" }), null);
  });
});
