import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDeskTrigger } from "../triggers.ts";
import {
  findDuplicateTrigger,
  findSameDayDropCollision,
  triggersToAutoDisable,
  validateTriggerAgainstBook,
  validateTriggerCreate,
  validateTriggerEnable,
  validateTriggerUpdate,
} from "../trigger-validate.ts";

describe("trigger-validate", () => {
  const bookRich = { cash: 50_000, openSymbols: ["AAPL", "TSLA"] };
  const bookBroke = { cash: 100, openSymbols: [] as string[] };

  it("requires an open lot for stop-style paper_sell", () => {
    const miss = validateTriggerAgainstBook({
      action: "paper_sell",
      symbol: "GOOG",
      notionalUsd: 1000,
      condition: { kind: "price_below", value: 200 },
      book: bookRich,
    });
    assert.equal(miss.ok, false);

    const bracket = validateTriggerAgainstBook({
      action: "paper_sell",
      symbol: "GOOG",
      notionalUsd: 1000,
      condition: { kind: "day_gain_pct", value: 8 },
      book: bookRich,
    });
    assert.equal(bracket.ok, true);

    const hit = validateTriggerAgainstBook({
      action: "paper_sell",
      symbol: "AAPL",
      notionalUsd: 1000,
      condition: { kind: "price_below", value: 100 },
      book: bookRich,
    });
    assert.equal(hit.ok, true);
  });

  it("requires cash for paper_buy", () => {
    const miss = validateTriggerAgainstBook({
      action: "paper_buy",
      symbol: "NVDA",
      notionalUsd: 1000,
      condition: { kind: "day_drop_pct", value: 3 },
      book: bookBroke,
    });
    assert.equal(miss.ok, false);

    const hit = validateTriggerAgainstBook({
      action: "paper_buy",
      symbol: "NVDA",
      notionalUsd: 1000,
      condition: { kind: "day_drop_pct", value: 3 },
      book: bookRich,
    });
    assert.equal(hit.ok, true);
  });

  it("blocks duplicate rules", () => {
    const existing = [
      buildDeskTrigger({
        symbol: "GOOG",
        condition: { kind: "day_drop_pct", value: 3 },
        action: "paper_buy",
        notionalUsd: 1000,
      }),
    ];
    const dup = findDuplicateTrigger(existing, {
      symbol: "GOOG",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "paper_buy",
    });
    assert.ok(dup);

    const create = validateTriggerCreate({
      symbol: "GOOG",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "paper_buy",
      notionalUsd: 500,
      existing,
      book: bookRich,
    });
    assert.equal(create.ok, false);
  });

  it("allows bracket buy + take-profit sell on same symbol", () => {
    const existing = [
      buildDeskTrigger({
        symbol: "TSLA",
        condition: { kind: "day_drop_pct", value: 2 },
        action: "paper_buy",
        notionalUsd: 1000,
      }),
    ];
    const create = validateTriggerCreate({
      symbol: "TSLA",
      condition: { kind: "day_gain_pct", value: 8 },
      action: "paper_sell",
      notionalUsd: 1000,
      existing,
      book: bookRich,
    });
    assert.equal(create.ok, true);
  });

  it("blocks day-drop buy + day-drop sell collision", () => {
    const existing = [
      buildDeskTrigger({
        symbol: "TSLA",
        condition: { kind: "day_drop_pct", value: 2 },
        action: "paper_buy",
        notionalUsd: 1000,
      }),
    ];
    const collision = findSameDayDropCollision(existing, {
      symbol: "TSLA",
      action: "paper_sell",
      condition: { kind: "day_drop_pct", value: 5 },
    });
    assert.ok(collision);

    const create = validateTriggerCreate({
      symbol: "TSLA",
      condition: { kind: "day_drop_pct", value: 5 },
      action: "paper_sell",
      notionalUsd: 1000,
      existing,
      book: bookRich,
    });
    assert.equal(create.ok, false);
  });

  it("re-validates on enable", () => {
    const sell = buildDeskTrigger({
      symbol: "MSFT",
      condition: { kind: "price_above", value: 500 },
      action: "paper_sell",
      enabled: false,
    });
    const okSell = validateTriggerEnable({
      trigger: sell,
      existing: [sell],
      book: bookRich,
    });
    assert.equal(okSell.ok, true);

    const buy = buildDeskTrigger({
      symbol: "NVDA",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "paper_buy",
      notionalUsd: 2000,
      enabled: false,
    });
    const ok = validateTriggerEnable({
      trigger: buy,
      existing: [buy],
      book: bookRich,
    });
    assert.equal(ok.ok, true);
  });

  it("lists trade triggers to auto-disable when the book no longer fits", () => {
    const sell = buildDeskTrigger({
      symbol: "GOOG",
      condition: { kind: "day_gain_pct", value: 4 },
      action: "paper_sell",
    });
    const buy = buildDeskTrigger({
      symbol: "NVDA",
      condition: { kind: "day_drop_pct", value: 3 },
      action: "paper_buy",
      notionalUsd: 5000,
    });
    const alert = buildDeskTrigger({
      symbol: "AAPL",
      condition: { kind: "price_below", value: 100 },
      action: "attention",
    });
    const paused = triggersToAutoDisable([sell, buy, alert], {
      cash: 1000,
      openSymbols: ["AAPL"],
    });
    assert.equal(paused.length, 2);
    assert.ok(paused.some((t) => t.id === sell.id));
    assert.ok(paused.some((t) => t.id === buy.id));
  });

  it("allows editing without duplicate conflict on self", () => {
    const rule = buildDeskTrigger({
      symbol: "TSLA",
      condition: { kind: "day_drop_pct", value: 1 },
      action: "paper_buy",
      notionalUsd: 3660,
    });
    const updated = validateTriggerUpdate({
      triggerId: rule.id,
      symbol: rule.symbol,
      condition: { kind: "day_drop_pct", value: 2 },
      action: rule.action,
      notionalUsd: rule.notionalUsd,
      enabled: true,
      existing: [rule],
      book: bookRich,
    });
    assert.equal(updated.ok, true);
  });
});
