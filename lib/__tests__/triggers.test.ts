import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeskTrigger,
  defaultAutoPauseAfterFire,
  formatTriggerSummary,
  mergeScanUniverse,
  normalizeAutoPauseAfterFire,
  normalizeDeskTrigger,
  normalizeTriggerCondition,
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

  it("normalizes day % magnitude (rejects 0 / abs negatives)", () => {
    assert.deepEqual(
      normalizeTriggerCondition({ kind: "day_drop_pct", value: 3 }),
      { kind: "day_drop_pct", value: 3 },
    );
    assert.deepEqual(
      normalizeTriggerCondition({ kind: "day_drop_pct", value: -3 }),
      { kind: "day_drop_pct", value: 3 },
    );
    assert.equal(
      normalizeTriggerCondition({ kind: "day_drop_pct", value: 0 }),
      null,
    );
    assert.equal(
      normalizeTriggerCondition({ kind: "price_below", value: -10 }),
      null,
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

    const buy = buildDeskTrigger({
      symbol: "GOOG",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "paper_buy",
      notionalUsd: 2000,
    });
    assert.match(formatTriggerSummary(buy), /Paper buy \$2k/);
    assert.match(formatTriggerSummary(buy), /pause after fire/);
  });

  it("defaults autoPauseAfterFire by action", () => {
    assert.equal(defaultAutoPauseAfterFire("paper_buy"), true);
    assert.equal(defaultAutoPauseAfterFire("attention"), false);
    const legacy = normalizeDeskTrigger({
      symbol: "TSLA",
      condition: { kind: "day_drop_pct", value: 1 },
      action: "paper_buy",
      notionalUsd: 1000,
    });
    assert.equal(legacy?.autoPauseAfterFire, true);
    assert.equal(
      normalizeAutoPauseAfterFire(false, "paper_buy"),
      false,
    );
  });

  it("fires profit_usd_above from position context", () => {
    const t = buildDeskTrigger({
      symbol: "TSLA",
      condition: { kind: "profit_usd_above", value: 28 },
      action: "paper_sell",
    });
    assert.equal(
      normalizeTriggerCondition({ kind: "profit_usd_above", value: 28 })
        ?.value,
      28,
    );
    assert.equal(
      triggerConditionMet(
        t.condition,
        { changePct: 0.5, currentPrice: 400 },
        { unrealizedPnl: 30, unrealizedPnlPct: 2 },
      ),
      true,
    );
    assert.equal(
      triggerConditionMet(
        t.condition,
        { changePct: 0.5, currentPrice: 400 },
        null,
      ),
      false,
    );
    assert.match(formatTriggerSummary(t), /profit ≥ \$28/);
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
