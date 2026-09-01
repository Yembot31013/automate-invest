import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DESK_SETTINGS } from "../desk-settings.ts";
import {
  computeSymbolExposure,
  shouldBlockTriggerBuyFire,
  validateTriggerGuardrails,
} from "../trigger-guardrails.ts";
import { buildDeskTrigger } from "../triggers.ts";

describe("trigger-guardrails", () => {
  it("computes symbol exposure from position and armed buys", () => {
    const triggers = [
      buildDeskTrigger({
        symbol: "TSLA",
        condition: { kind: "day_drop_pct", value: 2 },
        action: "paper_buy",
        notionalUsd: 2000,
      }),
    ];
    const ctx = computeSymbolExposure("TSLA", triggers, 5000);
    assert.equal(ctx.armedBuyNotional, 2000);
    assert.equal(ctx.positionMarketValue, 5000);
    assert.equal(ctx.armedBuyNotional + ctx.positionMarketValue, 7000);
  });

  it("blocks create when exposure would exceed cap", () => {
    const triggers = [
      buildDeskTrigger({
        symbol: "TSLA",
        condition: { kind: "day_drop_pct", value: 1 },
        action: "paper_buy",
        notionalUsd: 5000,
      }),
    ];
    const result = validateTriggerGuardrails({
      settings: DEFAULT_DESK_SETTINGS,
      symbol: "TSLA",
      action: "paper_buy",
      notionalUsd: 5000,
      triggers,
      positions: [{ symbol: "TSLA", marketValue: 11_000 }],
    });
    assert.equal(result.ok, false);
  });

  it("blocks fire on bad book day", () => {
    const block = shouldBlockTriggerBuyFire({
      settings: DEFAULT_DESK_SETTINGS,
      symbol: "AAPL",
      notionalUsd: 1000,
      triggers: [],
      totalUnrealizedPnlPct: -4,
      buysToday: { count: 0, spendUsd: 0 },
    });
    assert.equal(block.blocked, true);
  });
});
