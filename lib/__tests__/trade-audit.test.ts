import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeRealizedPnl,
  formatTradeHistoryEntry,
  parseSourceFromNotes,
} from "../trade-audit-helpers.ts";

describe("trade-audit", () => {
  it("computes realized PnL from entry and exit", () => {
    const { realizedPnl, realizedPnlPct } = computeRealizedPnl({
      entryPrice: 100,
      exitPrice: 110,
      quantity: 10,
    });
    assert.equal(realizedPnl, 100);
    assert.equal(realizedPnlPct, 10);
  });

  it("parses trigger and auto sources from notes", () => {
    assert.deepEqual(parseSourceFromNotes("trigger:trg_abc123"), {
      source: "trigger",
      triggerId: "trg_abc123",
    });
    assert.deepEqual(parseSourceFromNotes("auto-entry:dip"), {
      source: "auto",
      autoReason: "dip",
    });
    assert.deepEqual(parseSourceFromNotes(undefined), { source: "manual" });
  });

  it("formats fill rows with PnL", () => {
    const line = formatTradeHistoryEntry({
      id: "ta_x",
      at: "2026-01-01T12:00:00.000Z",
      event: "fill",
      side: "sell",
      source: "trigger",
      symbol: "TSLA",
      exchange: "NASDAQ",
      positionId: "pp_1",
      quantity: 5,
      price: 250,
      notionalUsd: 1250,
      cashAfter: 50000,
      realizedPnl: 120,
      realizedPnlPct: 10.5,
      triggerId: "trg_1",
    });
    assert.match(line, /sell 5 TSLA/);
    assert.match(line, /PnL \+\$120/);
  });
});
