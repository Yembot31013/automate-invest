export type AssetClass = "equity" | "crypto";

export type ResolvedSymbol = {
  /** Canonical desk symbol — e.g. AAPL or BTC/USD */
  symbol: string;
  exchange: string;
  assetClass: AssetClass;
  /**
   * True when the user asked for crypto outside the allowlist.
   * Callers should refuse / reportCapabilityGap — do not hit Alpaca.
   */
  unsupportedCrypto?: boolean;
};

/**
 * Fixed crypto allowlist (aliases → Alpaca USD pairs).
 * Keep this deliberate — expand only after verifying Alpaca + news filters.
 */
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

const SUPPORTED_CRYPTO_PAIRS = [
  ...new Set(Object.values(CRYPTO_BASE_TO_PAIR)),
].sort();

const SUPPORTED_CRYPTO_PAIR_SET = new Set(SUPPORTED_CRYPTO_PAIRS);

function stripPairSeparators(raw: string): string {
  return raw.trim().toUpperCase().replaceAll(/\s+/g, "");
}

/** Canonical allowlisted pairs, e.g. BTC/USD, ETH/USD. */
export function listSupportedCryptoPairs(): string[] {
  return [...SUPPORTED_CRYPTO_PAIRS];
}

/** True only for allowlisted spot pairs (not arbitrary FOO/USD). */
export function isCryptoPair(symbol: string): boolean {
  const pair = canonicalizeCryptoPair(symbol);
  return pair != null && SUPPORTED_CRYPTO_PAIR_SET.has(pair);
}

export function defaultExchangeForSymbol(symbol: string): string {
  return isCryptoPair(symbol) ? "CRYPTO" : "NASDAQ";
}

/** Normalize BTCUSD / BTC-USD / btc → BTC/USD when allowlisted; else null. */
function canonicalizeCryptoPair(raw: string): string | null {
  const cleaned = stripPairSeparators(raw);
  if (!cleaned) return null;

  const fromAlias = CRYPTO_BASE_TO_PAIR[cleaned];
  if (fromAlias) return fromAlias;

  if (cleaned.includes("/")) {
    const pair = cleaned;
    const base = pair.split("/")[0] ?? "";
    return CRYPTO_BASE_TO_PAIR[base] ?? (SUPPORTED_CRYPTO_PAIR_SET.has(pair) ? pair : null);
  }

  if (/^[A-Z]{2,10}-USD$/.test(cleaned)) {
    const base = cleaned.slice(0, -4);
    return CRYPTO_BASE_TO_PAIR[base] ?? null;
  }

  if (/^[A-Z]{2,10}USD$/.test(cleaned) && cleaned.length <= 10) {
    const base = cleaned.slice(0, -3);
    return CRYPTO_BASE_TO_PAIR[base] ?? null;
  }

  return null;
}

function looksLikeCryptoIntent(cleaned: string, hint?: string): boolean {
  const h = hint?.trim().toUpperCase();
  if (h === "CRYPTO" || h === "COINBASE" || h === "BINANCE") return true;
  if (cleaned.includes("/")) return true;
  if (/^[A-Z]{2,10}-USD$/.test(cleaned)) return true;
  if (/^[A-Z]{2,10}USD$/.test(cleaned) && cleaned.length <= 10) {
    const base = cleaned.slice(0, -3);
    // Compact form only counts as crypto intent when base looks like a coin ticker
    return base.length <= 5;
  }
  return false;
}

/**
 * Resolve free-text / ticker input to a desk symbol.
 * Crypto is allowlist-only; unknown coins are flagged unsupportedCrypto.
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
  const allowlisted = canonicalizeCryptoPair(cleaned);
  if (allowlisted) {
    return { symbol: allowlisted, exchange: "CRYPTO", assetClass: "crypto" };
  }

  if (looksLikeCryptoIntent(cleaned, hint)) {
    const attempted = cleaned.includes("/")
      ? cleaned
      : cleaned.includes("-")
        ? cleaned.replace("-", "/")
        : cleaned.endsWith("USD")
          ? `${cleaned.slice(0, -3)}/USD`
          : `${cleaned}/USD`;
    return {
      symbol: attempted,
      exchange: "CRYPTO",
      assetClass: "crypto",
      unsupportedCrypto: true,
    };
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

const CRYPTO_NEWS_ALIASES: Record<string, string[]> = {
  BTC: ["bitcoin", "btc", "xbt"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana", "sol"],
  DOGE: ["dogecoin", "doge"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  UNI: ["uniswap", "uni"],
  AAVE: ["aave"],
  LTC: ["litecoin", "ltc"],
  BCH: ["bitcoin cash", "bch"],
  DOT: ["polkadot", "dot"],
  MATIC: ["polygon", "matic"],
  SHIB: ["shiba", "shib"],
  XRP: ["xrp", "ripple"],
  ADA: ["cardano", "ada"],
};

/** Lowercase needles used to filter Finnhub crypto-category headlines for a pair. */
export function cryptoNewsNeedles(symbol: string): string[] {
  const pair = canonicalizeCryptoPair(symbol) ?? resolveSymbolInput(symbol).symbol;
  const base = pair.split("/")[0] ?? "";
  const aliases = CRYPTO_NEWS_ALIASES[base] ?? [base.toLowerCase()];
  return [...new Set(aliases.map((a) => a.toLowerCase()).filter(Boolean))];
}
