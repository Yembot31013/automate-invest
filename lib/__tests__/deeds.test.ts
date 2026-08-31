import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deskDeedForTool } from "../agent/deeds.ts";

describe("deskDeedForTool", () => {
  it("hides raw tool chrome and includes symbol when present", () => {
    const running = deskDeedForTool({
      toolName: "getSnapshot",
      state: "input-available",
      input: { symbol: "SOL/USD" },
    });
    assert.equal(running.phase, "running");
    assert.match(running.label, /tape/i);
    assert.match(running.label, /SOL\/USD/);
    assert.doesNotMatch(running.label, /TOOL|getSnapshot/i);
    assert.match(running.hint, /SOL\/USD/);
    assert.doesNotMatch(running.hint, /getSnapshot/);

    const done = deskDeedForTool({
      toolName: "getSnapshot",
      state: "done",
      input: { symbol: "SOL/USD" },
    });
    assert.equal(done.phase, "done");
    assert.match(done.label, /checked/i);
    assert.match(done.hint, /Checked tape.*SOL\/USD/i);
  });

  it("maps paper buy with a specific qty/symbol hint", () => {
    const deed = deskDeedForTool({
      toolName: "paperBuy",
      state: "output-available",
      input: { symbol: "NVDA", quantity: 5 },
      output: {
        ok: true,
        symbol: "NVDA",
        quantity: 5,
        entryPrice: 120.5,
        cashRemaining: 99400,
      },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /Paper buy/i);
    assert.match(deed.hint, /5 NVDA/);
    assert.match(deed.hint, /\$120\.5|\$120\.50/);
    assert.doesNotMatch(deed.hint, /paperBuy/);
  });

  it("maps forex lookup deeds", () => {
    const deed = deskDeedForTool({
      toolName: "lookupForex",
      state: "output-available",
      input: { currency: "USD", amountNgn: 1034 },
      output: { ok: true, currency: "USD", pair: "USD/NGN", ngnPerUnit: 1600.25 },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /FX/i);
    assert.match(deed.hint, /USD\/NGN/);
    assert.doesNotMatch(deed.hint, /lookupForex/);
  });

  it("shows monitor failure when tool returned ok false", () => {
    const deed = deskDeedForTool({
      toolName: "monitorSymbol",
      state: "output-available",
      input: { symbol: "XAU/USD" },
      output: { ok: false, error: "Could not verify XAU/USD" },
    });
    assert.equal(deed.phase, "error");
    assert.match(deed.label, /Couldn't pin/i);
    assert.match(deed.hint, /Couldn't pin XAU\/USD/i);
    assert.match(deed.hint, /Could not verify/);
  });

  it("keeps paperSellMany chip compact but lists every sold symbol in the tip", () => {
    const deed = deskDeedForTool({
      toolName: "paperSellMany",
      state: "output-available",
      input: { symbols: ["BTC/USD", "DANGCEM", "AMZN"] },
      output: {
        ok: true,
        closedCount: 3,
        remainingOpen: 1,
        closed: [
          { id: "1", symbol: "BTC/USD", quantity: 1, exitPrice: 1, unrealizedPnl: 0, unrealizedPnlPct: 0 },
          { id: "2", symbol: "DANGCEM", quantity: 1, exitPrice: 1, unrealizedPnl: 0, unrealizedPnlPct: 0 },
          { id: "3", symbol: "AMZN", quantity: 1, exitPrice: 1, unrealizedPnl: 0, unrealizedPnlPct: 0 },
        ],
      },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /Paper sells/i);
    assert.match(deed.label, /BTC\/USD \+2/);
    assert.match(deed.hint, /BTC\/USD/);
    assert.match(deed.hint, /DANGCEM/);
    assert.match(deed.hint, /AMZN/);
    assert.match(deed.hint, /1 still open/);
    assert.doesNotMatch(deed.hint, /paperSellMany/);
  });

  it("maps sell-all flat book in the tip", () => {
    const deed = deskDeedForTool({
      toolName: "paperSellMany",
      state: "output-available",
      input: { sellAll: true },
      output: {
        ok: true,
        closedCount: 2,
        remainingOpen: 0,
        closed: [
          { id: "1", symbol: "NVDA", quantity: 1, exitPrice: 1, unrealizedPnl: 0, unrealizedPnlPct: 0 },
          { id: "2", symbol: "AAPL", quantity: 1, exitPrice: 1, unrealizedPnl: 0, unrealizedPnlPct: 0 },
        ],
      },
    });
    assert.match(deed.label, /all/i);
    assert.match(deed.hint, /NVDA/);
    assert.match(deed.hint, /AAPL/);
    assert.match(deed.hint, /flat/i);
  });
});
