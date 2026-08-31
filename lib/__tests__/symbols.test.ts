import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultExchangeForSymbol,
  findWatchlistSymbol,
  isCommodityPair,
  isCryptoPair,
  isForexPair,
  isMacroPair,
  listSupportedCryptoPairs,
  resolveSymbolInput,
  symbolsMatch,
  cryptoNewsNeedles,
  yahooChartSymbol,
} from "../symbols.ts";

describe("resolveSymbolInput", () => {
  it("maps bitcoin aliases to BTC/USD spot", () => {
    assert.deepEqual(resolveSymbolInput("bitcoin"), {
      symbol: "BTC/USD",
      exchange: "CRYPTO",
      assetClass: "crypto",
      currency: "USD",
    });
    assert.equal(resolveSymbolInput("btc").symbol, "BTC/USD");
    assert.equal(resolveSymbolInput("BTCUSD").symbol, "BTC/USD");
    assert.equal(resolveSymbolInput("btc-usd").symbol, "BTC/USD");
  });

  it("leaves US equities alone", () => {
    assert.deepEqual(resolveSymbolInput("AAPL"), {
      symbol: "AAPL",
      exchange: "NASDAQ",
      assetClass: "equity",
      currency: "USD",
    });
  });

  it("maps NGX venue forms and Nigerian names", () => {
    assert.deepEqual(resolveSymbolInput("NGX:DANGCEM"), {
      symbol: "DANGCEM",
      exchange: "NGX",
      assetClass: "equity",
      currency: "NGN",
    });
    assert.equal(resolveSymbolInput("gtco.ng").symbol, "GTCO");
    assert.equal(resolveSymbolInput("dangote cement").exchange, "NGX");
    assert.equal(resolveSymbolInput("dangote cement").symbol, "DANGCEM");
    assert.equal(resolveSymbolInput("dangote stock").symbol, "DANGCEM");
    assert.equal(resolveSymbolInput("dangote").symbol, "DANGCEM");
    assert.equal(resolveSymbolInput("ACCESS", "NGX").symbol, "ACCESS");
    assert.equal(resolveSymbolInput("ACCESS").exchange, "NASDAQ");
  });

  it("maps FX and commodity aliases before crypto intent", () => {
    assert.deepEqual(resolveSymbolInput("xauusd"), {
      symbol: "XAU/USD",
      exchange: "COMMODITY",
      assetClass: "commodity",
      currency: "USD",
    });
    assert.equal(resolveSymbolInput("gold").symbol, "XAU/USD");
    assert.equal(resolveSymbolInput("EURUSD").symbol, "EUR/USD");
    assert.equal(resolveSymbolInput("eur/usd").exchange, "FOREX");
    assert.equal(resolveSymbolInput("wti").symbol, "WTI/USD");
    assert.equal(isMacroPair("XAU/USD"), true);
    assert.equal(isForexPair("EUR/USD"), true);
    assert.equal(isCommodityPair("XAG/USD"), true);
    assert.equal(yahooChartSymbol("XAU/USD", "commodity"), "GC=F");
    assert.equal(yahooChartSymbol("EUR/USD", "forex"), "EURUSD=X");
  });
});

describe("crypto helpers", () => {
  it("detects pairs and default exchange", () => {
    assert.equal(isCryptoPair("BTC/USD"), true);
    assert.equal(isCryptoPair("AAPL"), false);
    assert.equal(defaultExchangeForSymbol("ETH/USD"), "CRYPTO");
    assert.equal(defaultExchangeForSymbol("MSFT"), "NASDAQ");
    assert.equal(defaultExchangeForSymbol("DANGCEM"), "NGX");
  });

  it("matches slash and compact forms", () => {
    assert.equal(symbolsMatch("BTC/USD", "BTC"), true);
    assert.equal(symbolsMatch("BTC/USD", "bitcoin"), true);
    assert.equal(symbolsMatch("AAPL", "MSFT"), false);
  });

  it("finds stored watchlist symbols from aliases", () => {
    const list = [
      { symbol: "BTC/USD" },
      { symbol: "AAPL" },
      { symbol: "DANGCEM" },
    ];
    assert.equal(findWatchlistSymbol(list, "bitcoin"), "BTC/USD");
    assert.equal(findWatchlistSymbol(list, "AAPL"), "AAPL");
    assert.equal(findWatchlistSymbol(list, "dangote stock"), "DANGCEM");
    assert.equal(findWatchlistSymbol(list, "DANGCEM"), "DANGCEM");
    assert.equal(findWatchlistSymbol(list, "NVDA"), undefined);
  });

  it("builds crypto news needles for ETH", () => {
    const needles = cryptoNewsNeedles("ETH/USD");
    assert.ok(needles.includes("ethereum"));
    assert.ok(needles.includes("eth"));
  });

  it("rejects crypto outside the allowlist", () => {
    const pepe = resolveSymbolInput("PEPE/USD");
    assert.equal(pepe.unsupportedCrypto, true);
    assert.equal(pepe.assetClass, "crypto");
    assert.equal(isCryptoPair("PEPE/USD"), false);

    const random = resolveSymbolInput("randomcoin", "CRYPTO");
    assert.equal(random.unsupportedCrypto, true);
  });

  it("lists supported crypto pairs", () => {
    const pairs = listSupportedCryptoPairs();
    assert.ok(pairs.includes("BTC/USD"));
    assert.ok(pairs.includes("ETH/USD"));
    assert.ok(!pairs.includes("PEPE/USD"));
  });
});
