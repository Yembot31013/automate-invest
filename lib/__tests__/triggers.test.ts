import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeskTrigger,
  formatTriggerSummary,
  mergeScanUniverse,
  normalizeTriggerList,
  triggerConditionMet,
} from "../triggers.ts";

describe("triggers", () => {
  it("fires day_drop when changePct is deep enough", () => {
    const t = buildDeskTrigger({
      symbol: "GOOG",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "attention",
    });
    assert.equal(
      triggerConditionMet(t.condition, { changePct: -3.2, currentPrice: 100 }),
      true,
    );
    assert.equal(
      triggerConditionMet(t.condition, { changePct: -2.9, currentPrice: 100 }),
      false,
    );
  });

  it("fires price_below", () => {
    const t = buildDeskTrigger({
      symbol: "AAPL",
      condition: { kind: "price_below", value: 180 },
      action: "paper_buy",
      notionalUsd: 500,
    });
    assert.equal(t.notionalUsd, 500);
    assert.equal(
      triggerConditionMet(t.condition, { changePct: 0, currentPrice: 179.5 }),
      true,
    );
  });

  it("normalizes lists and formats summary", () => {
    const list = normalizeTriggerList([
      buildDeskTrigger({
        symbol: "tsla",
        condition: { kind: "day_gain_pct", value: 5 },
        action: "paper_sell",
      }),
      { junk: true },
    ]);
    assert.equal(list.length, 1);
    assert.match(formatTriggerSummary(list[0]!), /TSLA/);
    assert.match(formatTriggerSummary(list[0]!), /Paper sell/);
  });
});

describe("mergeScanUniverse", () => {
  it("dedupes symbols preferring first exchange", () => {
    const merged = mergeScanUniverse(
      [{ symbol: "AAPL", exchange: "NASDAQ", addedAt: "a" }],
      [
        { symbol: "aapl", exchange: "NYSE", addedAt: "b" },
        { symbol: "GOOG", exchange: "NASDAQ", addedAt: "c" },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged.find((e) => e.symbol === "AAPL")?.exchange, "NASDAQ");
    assert.ok(merged.some((e) => e.symbol === "GOOG"));
  });
});
