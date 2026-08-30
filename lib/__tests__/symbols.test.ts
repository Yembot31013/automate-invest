import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultExchangeForSymbol,
  findWatchlistSymbol,
  isCryptoPair,
  resolveSymbolInput,
  symbolsMatch,
} from "../symbols.ts";

describe("resolveSymbolInput", () => {
  it("maps bitcoin aliases to BTC/USD spot", () => {
    assert.deepEqual(resolveSymbolInput("bitcoin"), {
      symbol: "BTC/USD",
      exchange: "CRYPTO",
      assetClass: "crypto",
    });
    assert.equal(resolveSymbolInput("btc").symbol, "BTC/USD");
    assert.equal(resolveSymbolInput("BTCUSD").symbol, "BTC/USD");
    assert.equal(resolveSymbolInput("btc-usd").symbol, "BTC/USD");
  });

  it("leaves equities alone", () => {
    assert.deepEqual(resolveSymbolInput("AAPL"), {
      symbol: "AAPL",
      exchange: "NASDAQ",
      assetClass: "equity",
    });
  });
});

describe("crypto helpers", () => {
  it("detects pairs and default exchange", () => {
    assert.equal(isCryptoPair("BTC/USD"), true);
    assert.equal(isCryptoPair("AAPL"), false);
    assert.equal(defaultExchangeForSymbol("ETH/USD"), "CRYPTO");
    assert.equal(defaultExchangeForSymbol("MSFT"), "NASDAQ");
  });

  it("matches slash and compact forms", () => {
    assert.equal(symbolsMatch("BTC/USD", "BTC"), true);
    assert.equal(symbolsMatch("BTC/USD", "bitcoin"), true);
    assert.equal(symbolsMatch("AAPL", "MSFT"), false);
  });

  it("finds stored watchlist symbols from aliases", () => {
    const list = [{ symbol: "BTC/USD" }, { symbol: "AAPL" }];
    assert.equal(findWatchlistSymbol(list, "bitcoin"), "BTC/USD");
    assert.equal(findWatchlistSymbol(list, "AAPL"), "AAPL");
    assert.equal(findWatchlistSymbol(list, "NVDA"), undefined);
  });
});
