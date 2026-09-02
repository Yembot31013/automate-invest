import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { structureArmBuyZoneAlertPrompt } from "../structure/arm-alert-prompt.ts";

describe("structureArmBuyZoneAlertPrompt", () => {
  it("asks for a buy-zone alert in plain language", () => {
    const prompt = structureArmBuyZoneAlertPrompt({
      symbol: "NZD/USD",
      timeframe: "1H",
      phase: "waiting_retrace",
      levels: {
        bosPrice: 0.59,
        swingHighPrice: 0.589,
        fvgLow: 0.5895,
        fvgHigh: 0.59,
        obLow: 0.58948,
        obHigh: 0.59004,
        stopLoss: 0.562,
        takeProfit: 0.65,
        currentPrice: 0.591,
        riskReward: 2,
      },
    });
    assert.match(prompt, /NZD\/USD/);
    assert.match(prompt, /0\.59004/);
    assert.match(prompt, /alert/i);
    assert.match(prompt, /no paper buy/i);
    assert.ok(!/createTrigger|price_below|action attention/i.test(prompt));
  });
});
