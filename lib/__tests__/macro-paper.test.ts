import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSymbolInput } from "../symbols.ts";

describe("macro paper trading unlock", () => {
  it("resolves gold and FX as commodity/forex so paper can mark them", () => {
    const gold = resolveSymbolInput("XAU/USD");
    assert.equal(gold.assetClass, "commodity");
    assert.equal(gold.exchange, "COMMODITY");

    const nzd = resolveSymbolInput("NZD/USD");
    assert.equal(nzd.assetClass, "forex");
    assert.equal(nzd.exchange, "FOREX");
  });
});
