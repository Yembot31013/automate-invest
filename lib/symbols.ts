export type AssetClass = "equity" | "crypto";

export type ResolvedSymbol = {
  /** Canonical desk symbol — e.g. AAPL or BTC/USD */
  symbol: string;
  exchange: string;
  assetClass: AssetClass;
};

/** Well-known crypto bases we route to Alpaca spot pairs (not equity lookalikes). */
const CRYPTO_BASE_TO_PAIR: Record<string, string> = {
  BTC: "BTC/USD",
  XBT: "BTC/USD",
  BITCOIN: "BTC/USD",
  ETH: "ETH/USD",
  ETHEREUM: "ETH/USD",
  SOL: "SOL/USD",
  SOLANA: "SOL/USD",
  DOGE: "DOGE/USD",
  DOGECOIN: "DOGE/USD",
  AVAX: "AVAX/USD",
  LINK: "LINK/USD",
  UNI: "UNI/USD",
  AAVE: "AAVE/USD",
  LTC: "LTC/USD",
  BCH: "BCH/USD",
  DOT: "DOT/USD",
  MATIC: "MATIC/USD",
  SHIB: "SHIB/USD",
  XRP: "XRP/USD",
  ADA: "ADA/USD",
};

function stripPairSeparators(raw: string): string {
  return raw.trim().toUpperCase().replaceAll(/\s+/g, "");
}

/** True when the stored/canonical symbol is an Alpaca crypto pair. */
export function isCryptoPair(symbol: string): boolean {
  const s = stripPairSeparators(symbol);
  return s.includes("/") || /^[A-Z]{2,10}USD$/.test(s);
}

export function defaultExchangeForSymbol(symbol: string): string {
  return isCryptoPair(symbol) ? "CRYPTO" : "NASDAQ";
}

/**
 * Resolve free-text / ticker input to a desk symbol.
 * Crypto aliases (bitcoin, BTC) map to spot pairs so we never land on equity "BTC".
 */
export function resolveSymbolInput(
  raw: string,
  exchangeHint?: string,
): ResolvedSymbol {
  const cleaned = stripPairSeparators(raw);
  if (!cleaned) {
    return { symbol: "", exchange: "NASDAQ", assetClass: "equity" };
  }

  const hint = exchangeHint?.trim().toUpperCase();
  if (hint === "CRYPTO" || hint === "COINBASE" || hint === "BINANCE") {
    const pair = cleaned.includes("/")
      ? cleaned
      : cleaned.endsWith("USD")
        ? `${cleaned.slice(0, -3)}/USD`
        : `${cleaned}/USD`;
    return { symbol: pair, exchange: "CRYPTO", assetClass: "crypto" };
  }

  if (cleaned.includes("/")) {
    return { symbol: cleaned, exchange: "CRYPTO", assetClass: "crypto" };
  }

  if (/^[A-Z]{2,10}-USD$/.test(cleaned)) {
    const pair = cleaned.replace("-", "/");
    return { symbol: pair, exchange: "CRYPTO", assetClass: "crypto" };
  }

  if (/^[A-Z]{2,10}USD$/.test(cleaned) && cleaned.length <= 10) {
    const base = cleaned.slice(0, -3);
    if (CRYPTO_BASE_TO_PAIR[base] || base.length <= 5) {
      return {
        symbol: `${base}/USD`,
        exchange: "CRYPTO",
        assetClass: "crypto",
      };
    }
  }

  const fromAlias = CRYPTO_BASE_TO_PAIR[cleaned];
  if (fromAlias) {
    return { symbol: fromAlias, exchange: "CRYPTO", assetClass: "crypto" };
  }

  return {
    symbol: cleaned,
    exchange: hint && hint !== "CRYPTO" ? hint : "NASDAQ",
    assetClass: "equity",
  };
}

/** Compare tickers ignoring slash form (BTC/USD vs BTCUSD). */
export function symbolsMatch(a: string, b: string): boolean {
  const left = resolveSymbolInput(a).symbol;
  const right = resolveSymbolInput(b).symbol;
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replaceAll("/", "") === right.replaceAll("/", "");
}

/** Find the stored watchlist symbol matching free-text input (e.g. bitcoin → BTC/USD). */
export function findWatchlistSymbol(
  entries: ReadonlyArray<{ symbol: string }>,
  input: string,
): string | undefined {
  return entries.find((entry) => symbolsMatch(entry.symbol, input))?.symbol;
}
