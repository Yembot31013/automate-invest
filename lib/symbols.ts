export type AssetClass = "equity" | "crypto" | "forex" | "commodity";

export type ResolvedSymbol = {
  /** Canonical desk symbol — e.g. AAPL, BTC/USD, or DANGCEM */
  symbol: string;
  exchange: string;
  assetClass: AssetClass;
  /**
   * True when the user asked for crypto outside the allowlist.
   * Callers should refuse / reportCapabilityGap — do not hit Alpaca.
   */
  unsupportedCrypto?: boolean;
  /** Quote currency for display / paper conversion. */
  currency?: "USD" | "NGN";
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

/** Major FX + key commodities (Yahoo chart-backed on the desk). */
const FX_PAIR_ALIASES: Record<string, string> = {
  EURUSD: "EUR/USD",
  EUR: "EUR/USD",
  GBPUSD: "GBP/USD",
  CABLE: "GBP/USD",
  USDJPY: "USD/JPY",
  JPY: "USD/JPY",
  USDCHF: "USD/CHF",
  CHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  AUD: "AUD/USD",
  USDCAD: "USD/CAD",
  CAD: "USD/CAD",
  NZDUSD: "NZD/USD",
  NZD: "NZD/USD",
  EURGBP: "EUR/GBP",
};

const COMMODITY_ALIASES: Record<string, string> = {
  XAUUSD: "XAU/USD",
  XAU: "XAU/USD",
  GOLD: "XAU/USD",
  XAGUSD: "XAG/USD",
  XAG: "XAG/USD",
  SILVER: "XAG/USD",
  WTIUSD: "WTI/USD",
  WTI: "WTI/USD",
  USOIL: "WTI/USD",
  CRUDE: "WTI/USD",
  OIL: "WTI/USD",
};

const SUPPORTED_FX_PAIRS = [
  ...new Set(Object.values(FX_PAIR_ALIASES)),
].sort();

const SUPPORTED_COMMODITY_PAIRS = [
  ...new Set(Object.values(COMMODITY_ALIASES)),
].sort();

const SUPPORTED_FX_PAIR_SET = new Set(SUPPORTED_FX_PAIRS);
const SUPPORTED_COMMODITY_PAIR_SET = new Set(SUPPORTED_COMMODITY_PAIRS);

/**
 * Well-known NGX tickers (sync resolve without an API round-trip).
 * Prefer explicit NGX: / .NG when a short ticker could collide with US names.
 */
/**
 * Auto-resolve only when the ticker is clearly NGX-first (avoids US collisions
 * like NESTLE / UNILEVER). Use NGX:TICKER or exchange=NGX for anything else.
 */
const NGX_TICKER_SET = new Set([
  "DANGCEM",
  "BUACEMENT",
  "BUAFOODS",
  "GTCO",
  "ZENITHBANK",
  "FBNH",
  "MTNN",
  "AIRTELAFRI",
  "SEPLAT",
  "DANGSUGAR",
  "FLOURMILL",
  "WAPCO",
  "OANDO",
  "CONOIL",
  "PRESCO",
  "OKOMUOIL",
  "GEREGU",
  "TRANSPOWER",
  "INTBREW",
  "STERLINGNG",
  "FIDELITYBK",
  "UNITYBNK",
  "WEMABANK",
  "JAIZBANK",
  "GUINNESS",
]);

/** Compact name aliases → NGX ticker (spaces stripped / uppercased). */
const NGX_NAME_ALIASES: Record<string, string> = {
  DANGOTECEMENT: "DANGCEM",
  DANGOTE: "DANGCEM",
  BUACEMENT: "BUACEMENT",
  BUA: "BUACEMENT",
  GUARANTYTRUST: "GTCO",
  GUARANTYTRUSTBANK: "GTCO",
  GTBANK: "GTCO",
  ZENITHBANK: "ZENITHBANK",
  ZENITH: "ZENITHBANK",
  ACCESSBANK: "ACCESS",
  ACCESSHOLDINGS: "ACCESS",
  UNITEDBANKFORAFRICA: "UBA",
  FBNHOLDINGS: "FBNH",
  FIRSTBANK: "FBNH",
  MTNNIGERIA: "MTNN",
  MTN: "MTNN",
  AIRTELAFRICA: "AIRTELAFRI",
  AIRTEL: "AIRTELAFRI",
  SEPLATENERGY: "SEPLAT",
  NIGERIANBREWERIES: "NB",
  GUINNESSNIGERIA: "GUINNESS",
  DANGOTESUGAR: "DANGSUGAR",
  FLOURMILLS: "FLOURMILL",
  LAFARGEAFRICA: "WAPCO",
  LAFARGE: "WAPCO",
};

function stripPairSeparators(raw: string): string {
  return raw.trim().toUpperCase().replaceAll(/\s+/g, "");
}

/** Canonical allowlisted pairs, e.g. BTC/USD, ETH/USD. */
export function listSupportedCryptoPairs(): string[] {
  return [...SUPPORTED_CRYPTO_PAIRS];
}

/** Example NGX tickers for prompts / help text. */
export function listExampleNgxTickers(): string[] {
  return ["DANGCEM", "GTCO", "MTNN", "ZENITHBANK", "BUACEMENT", "AIRTELAFRI"];
}

export function listSupportedFxPairs(): string[] {
  return [...SUPPORTED_FX_PAIRS];
}

export function listSupportedCommodityPairs(): string[] {
  return [...SUPPORTED_COMMODITY_PAIRS];
}

/** FX + commodities the desk can snapshot (for prompts). */
export function listSupportedMacroPairs(): string[] {
  return [...SUPPORTED_FX_PAIRS, ...SUPPORTED_COMMODITY_PAIRS].sort();
}

export function isForexPair(symbol: string): boolean {
  const pair = canonicalizeFxPair(symbol);
  return pair != null && SUPPORTED_FX_PAIR_SET.has(pair);
}

export function isCommodityPair(symbol: string): boolean {
  const pair = canonicalizeCommodityPair(symbol);
  return pair != null && SUPPORTED_COMMODITY_PAIR_SET.has(pair);
}

export function isMacroPair(symbol: string): boolean {
  return isForexPair(symbol) || isCommodityPair(symbol);
}

function canonicalizeFxPair(raw: string): string | null {
  const cleaned = stripPairSeparators(raw);
  if (!cleaned) return null;

  const fromAlias = FX_PAIR_ALIASES[cleaned];
  if (fromAlias) return fromAlias;

  if (cleaned.includes("/")) {
    const pair = cleaned.replace("-", "/");
    return SUPPORTED_FX_PAIR_SET.has(pair) ? pair : null;
  }

  if (/^[A-Z]{3}[A-Z]{3}$/.test(cleaned)) {
    const slash = `${cleaned.slice(0, 3)}/${cleaned.slice(3)}`;
    if (SUPPORTED_FX_PAIR_SET.has(slash)) return slash;
    const slashAlt = `${cleaned.slice(0, 3)}/${cleaned.slice(3)}`;
    return FX_PAIR_ALIASES[cleaned] ?? (SUPPORTED_FX_PAIR_SET.has(slashAlt) ? slashAlt : null);
  }

  return null;
}

function canonicalizeCommodityPair(raw: string): string | null {
  const cleaned = stripPairSeparators(raw);
  if (!cleaned) return null;

  const fromAlias = COMMODITY_ALIASES[cleaned];
  if (fromAlias) return fromAlias;

  if (cleaned.includes("/")) {
    const pair = cleaned.replace("-", "/");
    return SUPPORTED_COMMODITY_PAIR_SET.has(pair) ? pair : null;
  }

  if (/^[A-Z]{3}USD$/.test(cleaned)) {
    const pair = `${cleaned.slice(0, 3)}/USD`;
    return SUPPORTED_COMMODITY_PAIR_SET.has(pair) ? pair : null;
  }

  return null;
}

/** Yahoo Finance chart ticker for desk FX / commodity pairs. */
export function yahooChartSymbol(
  deskSymbol: string,
  assetClass: AssetClass,
): string {
  const pair = deskSymbol.toUpperCase();
  if (assetClass === "commodity") {
    if (pair === "XAU/USD") return "GC=F";
    if (pair === "XAG/USD") return "SI=F";
    if (pair === "WTI/USD") return "CL=F";
  }
  const compact = pair.replace("/", "");
  return `${compact}=X`;
}

/** True only for allowlisted spot pairs (not arbitrary FOO/USD). */
export function isCryptoPair(symbol: string): boolean {
  const pair = canonicalizeCryptoPair(symbol);
  return pair != null && SUPPORTED_CRYPTO_PAIR_SET.has(pair);
}

export function isNgxExchange(exchange?: string | null): boolean {
  const ex = exchange?.trim().toUpperCase();
  return ex === "NGX" || ex === "NGN" || ex === "NSE" || ex === "NIGERIA";
}

/** Sync check against seed list / aliases (API may know more). */
export function isKnownNgxTicker(symbol: string): boolean {
  const cleaned = stripPairSeparators(symbol)
    .replace(/\.NGX$/i, "")
    .replace(/\.NG$/i, "")
    .replace(/^NGX:/i, "");
  if (!cleaned) return false;
  if (NGX_TICKER_SET.has(cleaned)) return true;
  const aliased = NGX_NAME_ALIASES[cleaned];
  return Boolean(aliased && NGX_TICKER_SET.has(aliased));
}

export function defaultExchangeForSymbol(symbol: string): string {
  if (isCryptoPair(symbol)) return "CRYPTO";
  if (isCommodityPair(symbol)) return "COMMODITY";
  if (isForexPair(symbol)) return "FOREX";
  if (isKnownNgxTicker(symbol)) return "NGX";
  return "NASDAQ";
}

export function quoteCurrencyForExchange(exchange?: string | null): "USD" | "NGN" {
  return isNgxExchange(exchange) ? "NGN" : "USD";
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
    return base.length <= 5;
  }
  return false;
}

function parseNgxVenueSymbol(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("NGX:")) {
    const sym = trimmed.slice(4).replaceAll(/\s+/g, "");
    return sym || null;
  }

  const compact = stripPairSeparators(trimmed);
  if (compact.endsWith(".NGX") || compact.endsWith(".NG")) {
    return compact.replace(/\.NGX$/, "").replace(/\.NG$/, "") || null;
  }

  return null;
}

function canonicalizeNgxTicker(cleaned: string): string | null {
  const fromAlias = NGX_NAME_ALIASES[cleaned];
  if (fromAlias) return fromAlias;
  if (NGX_TICKER_SET.has(cleaned)) return cleaned;
  return null;
}

/**
 * Resolve free-text / ticker input to a desk symbol.
 * Crypto is allowlist-only; unknown coins are flagged unsupportedCrypto.
 * NGX via NGX:TICKER, TICKER.NG, Nigeria exchange hints, or known Nigerian names/tickers.
 */
export function resolveSymbolInput(
  raw: string,
  exchangeHint?: string,
): ResolvedSymbol {
  const cleaned = stripPairSeparators(raw);
  if (!cleaned) {
    return { symbol: "", exchange: "NASDAQ", assetClass: "equity", currency: "USD" };
  }

  const hint = exchangeHint?.trim().toUpperCase();
  const allowlisted = canonicalizeCryptoPair(cleaned);
  if (allowlisted) {
    return {
      symbol: allowlisted,
      exchange: "CRYPTO",
      assetClass: "crypto",
      currency: "USD",
    };
  }

  const commodity = canonicalizeCommodityPair(cleaned);
  if (commodity) {
    return {
      symbol: commodity,
      exchange: "COMMODITY",
      assetClass: "commodity",
      currency: "USD",
    };
  }

  const fxPair = canonicalizeFxPair(cleaned);
  if (fxPair) {
    return {
      symbol: fxPair,
      exchange: "FOREX",
      assetClass: "forex",
      currency: "USD",
    };
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
      currency: "USD",
    };
  }

  const venueNgx = parseNgxVenueSymbol(raw);
  if (venueNgx) {
    const ticker = canonicalizeNgxTicker(venueNgx) ?? venueNgx;
    return {
      symbol: ticker,
      exchange: "NGX",
      assetClass: "equity",
      currency: "NGN",
    };
  }

  if (isNgxExchange(hint)) {
    const ticker = canonicalizeNgxTicker(cleaned) ?? cleaned;
    return {
      symbol: ticker,
      exchange: "NGX",
      assetClass: "equity",
      currency: "NGN",
    };
  }

  const ngxKnown = canonicalizeNgxTicker(cleaned);
  if (ngxKnown) {
    return {
      symbol: ngxKnown,
      exchange: "NGX",
      assetClass: "equity",
      currency: "NGN",
    };
  }

  return {
    symbol: cleaned,
    exchange: hint && hint !== "CRYPTO" ? hint : "NASDAQ",
    assetClass: "equity",
    currency: "USD",
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

const FX_NEWS_ALIASES: Record<string, string[]> = {
  "EUR/USD": ["eur/usd", "euro", "ecb", "eurusd"],
  "GBP/USD": ["gbp/usd", "sterling", "cable", "gbpusd", "bank of england"],
  "USD/JPY": ["usd/jpy", "usdjpy", "yen", "boj"],
  "USD/CHF": ["usd/chf", "usdchf", "franc", "snb"],
  "AUD/USD": ["aud/usd", "audusd", "aussie", "rba"],
  "USD/CAD": ["usd/cad", "usdcad", "loonie", "boc"],
  "NZD/USD": ["nzd/usd", "nzdusd", "kiwi", "rbnz"],
  "EUR/GBP": ["eur/gbp", "eurgbp"],
  "XAU/USD": ["gold", "xau", "xauusd", "bullion", "precious metal"],
  "XAG/USD": ["silver", "xag", "xagusd"],
  "WTI/USD": ["wti", "crude", "oil", "opec", "brent", "petroleum"],
};

/** Lowercase needles for Finnhub forex-category headline filtering. */
export function macroNewsNeedles(symbol: string): string[] {
  const resolved = resolveSymbolInput(symbol);
  const pair = resolved.symbol;
  const aliases = FX_NEWS_ALIASES[pair] ?? [
    pair.replace("/", "").toLowerCase(),
    pair.split("/")[0]?.toLowerCase() ?? "",
  ];
  return [...new Set(aliases.map((a) => a.toLowerCase()).filter(Boolean))];
}

/** Lowercase needles used to filter Finnhub crypto-category headlines for a pair. */
export function cryptoNewsNeedles(symbol: string): string[] {
  const pair = canonicalizeCryptoPair(symbol) ?? resolveSymbolInput(symbol).symbol;
  const base = pair.split("/")[0] ?? "";
  const aliases = CRYPTO_NEWS_ALIASES[base] ?? [base.toLowerCase()];
  return [...new Set(aliases.map((a) => a.toLowerCase()).filter(Boolean))];
}
