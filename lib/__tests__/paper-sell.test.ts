import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectOpenPositionsToSell } from "../paper-select.ts";

function openPos(id: string, symbol: string) {
  return { id, symbol };
}

describe("selectOpenPositionsToSell", () => {
  const book = [
    openPos("1", "NVDA"),
    openPos("2", "BTC/USD"),
    openPos("3", "AMZN"),
    openPos("4", "SOL/USD"),
  ];

  it("sellAll returns every open position", () => {
    const targets = selectOpenPositionsToSell(book, { sellAll: true });
    assert.equal(targets.length, 4);
    assert.deepEqual(
      targets.map((p) => p.symbol),
      ["NVDA", "BTC/USD", "AMZN", "SOL/USD"],
    );
  });

  it("matches a symbols list slash-insensitively", () => {
    const targets = selectOpenPositionsToSell(book, {
      symbols: ["btcusd", "AMZN", "missing"],
    });
    assert.equal(targets.length, 2);
    assert.deepEqual(
      targets.map((p) => p.symbol),
      ["BTC/USD", "AMZN"],
    );
  });

  it("returns empty when neither sellAll nor symbols", () => {
    assert.deepEqual(selectOpenPositionsToSell(book, {}), []);
  });
});
