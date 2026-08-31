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

    const done = deskDeedForTool({
      toolName: "getSnapshot",
      state: "done",
      input: { symbol: "SOL/USD" },
    });
    assert.equal(done.phase, "done");
    assert.match(done.label, /checked/i);
  });

  it("maps paper buy and keeps a technical hint", () => {
    const deed = deskDeedForTool({
      toolName: "paperBuy",
      state: "output-available",
      input: { symbol: "NVDA", quantity: 5 },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /Paper buy/i);
    assert.match(deed.hint, /paperBuy/);
  });

  it("maps forex lookup deeds", () => {
    const deed = deskDeedForTool({
      toolName: "lookupForex",
      state: "output-available",
      input: { currency: "USD", amountNgn: 1034 },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /FX/i);
    assert.doesNotMatch(deed.label, /lookupForex/);
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
  });

  it("maps paperSellMany deeds", () => {
    const deed = deskDeedForTool({
      toolName: "paperSellMany",
      state: "output-available",
      input: { sellAll: true },
      output: { ok: true, closedCount: 4, remainingOpen: 0 },
    });
    assert.equal(deed.phase, "done");
    assert.match(deed.label, /Paper sells/i);
    assert.match(deed.label, /all/i);
  });
});
