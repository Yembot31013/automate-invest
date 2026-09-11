import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OhlcBar } from "../../types/index.ts";
import { backtestBullishStructure } from "../structure/backtest.ts";
import { detectBullishStructure } from "../structure/bos-fvg-ob.ts";

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

/** Same synthetic series as structure detector tests, plus continuation. */
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

describe("backtestBullishStructure", () => {
  it("returns empty when not enough bars", () => {
    const result = backtestBullishStructure({
      symbol: "EUR/USD",
      timeframe: "2H",
      bars: [bar(0, 1, 1.01, 0.99, 1)],
    });
    assert.equal(result.tradeCount, 0);
    assert.ok(result.notes.some((n) => /at least/i.test(n)));
  });

  it("simulates at least one trade when a synthetic setup forms", () => {
    const bars = buildSyntheticSetupSeries();
    const live = detectBullishStructure("EUR/USD", bars, "2H");
    assert.ok(live.setup, "fixture should still detect a live setup");

    // Extend with a clear touch of the OB then a move to TP or continue.
    const setup = live.setup!;
    const next = [...bars];
    const n = next.length;
    // Touch order block
    next.push(
      bar(n, setup.obHigh, setup.obHigh + 0.0005, setup.obLow, setup.obLow + 0.0002),
    );
    // Push toward take profit
    next.push(
      bar(
        n + 1,
        setup.obHigh,
        setup.takeProfit + 0.001,
        setup.obHigh - 0.001,
        setup.takeProfit + 0.0005,
      ),
    );

    const result = backtestBullishStructure({
      symbol: "EUR/USD",
      timeframe: "2H",
      bars: next,
    });
    assert.ok(result.tradeCount >= 1);
    assert.ok(result.wins + result.losses + result.openTrades === result.tradeCount);
  });
});
