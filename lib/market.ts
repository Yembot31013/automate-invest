import type {
  CandleSeries,
  CompanyNewsItem,
  MarketSnapshot,
  NewsSentiment,
  OhlcBar,
} from "@/types";
import { acquireFinnhubSlot, cacheGet, cacheSet } from "@/lib/cache";
import { logger } from "@/lib/logger";
import {
  convertNgnToUsd,
  fetchNgxCompanyChart,
  fetchNgxCompanyNews,
  hasNgnMarketCredentials,
  isListedOnNgx,
  NgnMarketError,
} from "@/lib/ngnmarket";
import {
  defaultExchangeForSymbol,
  isCommodityPair,
  isCryptoPair,
  isForexPair,
  isKnownNgxTicker,
  isMacroPair,
  isNgxExchange,
  listSupportedCommodityPairs,
  listSupportedCryptoPairs,
  listSupportedFxPairs,
  listSupportedMacroPairs,
  macroNewsNeedles,
  resolveSymbolInput,
  cryptoNewsNeedles,
  yahooChartSymbol,
} from "@/lib/symbols";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2";
const ALPACA_CRYPTO_BARS = "https://data.alpaca.markets/v1beta3/crypto/us/bars";
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const DEFAULT_LOOKBACK_DAYS = 40;
const SMA_PERIOD = 14;
const VOLUME_AVG_PERIOD = 20;
const DIP_THRESHOLD_PCT = 8;
const VOLUME_SURGE_RATIO = 2;
const OHLC_CACHE_TTL = 300;
const SENTIMENT_CACHE_TTL = 600;
const NEWS_CACHE_TTL = 300;

class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MarketDataError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calculateSMA(values: number[], period: number): number {
  if (!Array.isArray(values) || values.length === 0) {
    throw new MarketDataError("Cannot calculate SMA: price series is empty");
  }
  if (period <= 0) {
    throw new MarketDataError("SMA period must be a positive integer");
  }
  if (values.length < period) {
    throw new MarketDataError(
      `Cannot calculate ${period}-day SMA: only ${values.length} data points available`,
    );
  }

  const window = values.slice(-period);
  const sum = window.reduce((acc, value) => {
    if (!Number.isFinite(value)) {
      throw new MarketDataError(
        "Cannot calculate SMA: non-finite value in series",
      );
    }
    return acc + value;
  }, 0);

  return sum / period;
}

export function calculateAverageVolume(
  volumes: number[],
  period = VOLUME_AVG_PERIOD,
): number {
  return calculateSMA(volumes, period);
}

interface FinnhubCandleResponse {
  s: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

function mapFinnhubCandles(
  symbol: string,
  payload: FinnhubCandleResponse,
): CandleSeries {
  if (payload.s === "no_data" || !payload.c?.length) {
    throw new MarketDataError(`No candle data returned for ${symbol}`);
  }

  const length = payload.c.length;
  const bars: OhlcBar[] = [];

  for (let i = 0; i < length; i += 1) {
    const close = payload.c[i];
    const open = payload.o?.[i] ?? close;
    const high = payload.h?.[i] ?? close;
    const low = payload.l?.[i] ?? close;
    const volume = payload.v?.[i] ?? 0;
    const timestamp = payload.t?.[i] ?? 0;

    if (!Number.isFinite(close)) {
      continue;
    }

    bars.push({ timestamp, open, high, low, close, volume });
  }

  if (bars.length === 0) {
    throw new MarketDataError(`Empty OHLC series after parsing ${symbol}`);
  }

  return { symbol, bars };
}

export async function fetchFinnhubDailyCandles(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  const cacheKey = `cache:ohlc:${symbol.toUpperCase()}:${lookbackDays}`;
  const cached = await cacheGet<CandleSeries>(cacheKey);
  if (cached?.bars?.length) {
    return cached;
  }

  await acquireFinnhubSlot();
  const token = requireEnv("FINNHUB_API_KEY");
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - lookbackDays);

  const url = new URL(`${FINNHUB_BASE}/stock/candle`);
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("resolution", "D");
  url.searchParams.set("from", String(unixSeconds(from)));
  url.searchParams.set("to", String(unixSeconds(to)));
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new MarketDataError(
      `Finnhub candles failed for ${symbol}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as FinnhubCandleResponse;
  const series = mapFinnhubCandles(symbol.toUpperCase(), payload);
  await cacheSet(cacheKey, series, OHLC_CACHE_TTL);
  return series;
}

interface AlpacaBarsResponse {
  bars?: Array<{
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
}

export async function fetchAlpacaDailyBars(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  const key = requireEnv("ALPACA_API_KEY");
  const secret = requireEnv("ALPACA_API_SECRET");

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - lookbackDays);

  const url = new URL(
    `${ALPACA_DATA_BASE}/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars`,
  );
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("limit", "100");
  url.searchParams.set("adjustment", "split");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new MarketDataError(
      `Alpaca bars failed for ${symbol}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as AlpacaBarsResponse;
  const rawBars = payload.bars ?? [];

  if (rawBars.length === 0) {
    throw new MarketDataError(`No Alpaca bar data for ${symbol}`);
  }

  const bars: OhlcBar[] = rawBars.map((bar) => ({
    timestamp: Math.floor(new Date(bar.t).getTime() / 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));

  return { symbol: symbol.toUpperCase(), bars };
}

interface AlpacaCryptoBarsResponse {
  bars?: Record<
    string,
    Array<{
      t: string;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }>
  >;
}

/** Spot crypto daily bars via Alpaca (e.g. BTC/USD) — free with normal API keys. */
export async function fetchAlpacaCryptoBars(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  const resolved = resolveSymbolInput(symbol, "CRYPTO");
  if (resolved.unsupportedCrypto || !isCryptoPair(resolved.symbol)) {
    throw new MarketDataError(
      `Unsupported crypto ${resolved.symbol || symbol}. Supported pairs: ${listSupportedCryptoPairs().join(", ")}`,
    );
  }
  const pair = resolved.symbol;
  const cacheKey = `cache:ohlc:crypto:${pair}:${lookbackDays}`;
  const cached = await cacheGet<CandleSeries>(cacheKey);
  if (cached?.bars?.length) {
    return cached;
  }

  const key = requireEnv("ALPACA_API_KEY");
  const secret = requireEnv("ALPACA_API_SECRET");

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - lookbackDays);

  const url = new URL(ALPACA_CRYPTO_BARS);
  url.searchParams.set("symbols", pair);
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("limit", "100");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new MarketDataError(
      `Alpaca crypto bars failed for ${pair}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as AlpacaCryptoBarsResponse;
  const rawBars = payload.bars?.[pair] ?? payload.bars?.[pair.toUpperCase()] ?? [];

  if (rawBars.length === 0) {
    throw new MarketDataError(`No Alpaca crypto bar data for ${pair}`);
  }

  const bars: OhlcBar[] = rawBars.map((bar) => ({
    timestamp: Math.floor(new Date(bar.t).getTime() / 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));

  const series = { symbol: pair, bars };
  await cacheSet(cacheKey, series, OHLC_CACHE_TTL);
  return series;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

/** FX / commodity daily bars via Yahoo Finance (Finnhub forex is paid-tier). */
export async function fetchYahooDailyOhlc(
  deskSymbol: string,
  assetClass: "forex" | "commodity",
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  const yahooSymbol = yahooChartSymbol(deskSymbol, assetClass);
  const cacheKey = `cache:ohlc:yahoo:${deskSymbol}:${lookbackDays}`;
  const cached = await cacheGet<CandleSeries>(cacheKey);
  if (cached?.bars?.length) {
    return cached;
  }

  const range =
    lookbackDays <= 30 ? "2mo" : lookbackDays <= 90 ? "6mo" : "1y";
  const url = new URL(
    `${YAHOO_CHART_BASE}/${encodeURIComponent(yahooSymbol)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", range);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "SignalDesk/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new MarketDataError(
      `Yahoo chart failed for ${deskSymbol}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as YahooChartResponse;
  const result = payload.chart?.result?.[0];
  if (payload.chart?.error || !result?.timestamp?.length) {
    throw new MarketDataError(
      `No Yahoo chart data for ${deskSymbol} (${yahooSymbol})`,
    );
  }

  const quote = result.indicators?.quote?.[0];
  const bars: OhlcBar[] = [];
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const close = quote?.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    const open = quote?.open?.[i] ?? close;
    const high = quote?.high?.[i] ?? close;
    const low = quote?.low?.[i] ?? close;
    const volume = quote?.volume?.[i] ?? 0;
    bars.push({
      timestamp: result.timestamp[i] ?? 0,
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
    });
  }

  if (bars.length === 0) {
    throw new MarketDataError(`Empty Yahoo OHLC for ${deskSymbol}`);
  }

  const trimmed = bars.slice(-Math.max(lookbackDays + 5, SMA_PERIOD + 5));
  const series = { symbol: deskSymbol.toUpperCase(), bars: trimmed };
  await cacheSet(cacheKey, series, OHLC_CACHE_TTL);
  return series;
}

function hasAlpacaCredentials(): boolean {
  return Boolean(
    process.env.ALPACA_API_KEY?.trim() &&
      process.env.ALPACA_API_SECRET?.trim(),
  );
}

async function fetchNgxDailyOhlc(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  if (!hasNgnMarketCredentials()) {
    throw new MarketDataError(
      "NGX listings need NGNMARKET_API_KEY configured (https://ngnmarket.com/developer)",
    );
  }

  try {
    const series = await fetchNgxCompanyChart(symbol, lookbackDays);
    return { symbol: series.symbol, bars: series.bars };
  } catch (error) {
    if (error instanceof NgnMarketError) {
      throw new MarketDataError(
        error.code === "PLAN_REQUIRED" || error.status === 403
          ? `NGX data for ${symbol} needs a higher NGN Market plan (Hobby for charts). Free still serves live quotes — check NGNMARKET_API_KEY and plan at https://ngnmarket.com/developer`
          : error.message,
      );
    }
    throw error;
  }
}

/**
 * Daily OHLC for desk math (SMA, volume ratio, dip %).
 * Crypto → Alpaca spot; NGX → NGN Market; US equities → Alpaca then Finnhub.
 */
export async function fetchDailyOhlc(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  exchangeHint?: string,
): Promise<CandleSeries> {
  const resolved = resolveSymbolInput(symbol, exchangeHint);
  if (resolved.unsupportedCrypto) {
    throw new MarketDataError(
      `Unsupported crypto ${resolved.symbol}. Supported pairs: ${listSupportedCryptoPairs().join(", ")}`,
    );
  }

  if (resolved.assetClass === "forex" || resolved.assetClass === "commodity") {
    return fetchYahooDailyOhlc(
      resolved.symbol,
      resolved.assetClass,
      lookbackDays,
    );
  }

  if (isCryptoPair(resolved.symbol) || resolved.assetClass === "crypto") {
    if (!hasAlpacaCredentials()) {
      throw new MarketDataError(
        "Crypto spot needs ALPACA_API_KEY/SECRET configured",
      );
    }
    return fetchAlpacaCryptoBars(resolved.symbol, lookbackDays);
  }

  if (
    isNgxExchange(resolved.exchange) ||
    isNgxExchange(exchangeHint) ||
    isKnownNgxTicker(resolved.symbol)
  ) {
    return fetchNgxDailyOhlc(resolved.symbol, lookbackDays);
  }

  const equitySymbol = resolved.symbol;
  const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY?.trim());
  const hasAlpaca = hasAlpacaCredentials();

  if (hasAlpaca) {
    try {
      return await fetchAlpacaDailyBars(equitySymbol, lookbackDays);
    } catch (error) {
      if (!hasFinnhub) throw error;
      logger.warn("market", "Alpaca OHLC failed; trying Finnhub candles", {
        symbol: equitySymbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (hasFinnhub) {
    return fetchFinnhubDailyCandles(equitySymbol, lookbackDays);
  }

  throw new MarketDataError(
    "No market data credentials configured (ALPACA_API_KEY/SECRET or FINNHUB_API_KEY)",
  );
}

export type VerifiedSymbol = {
  symbol: string;
  exchange: string;
};

/**
 * Confirm a ticker resolves with the same OHLC path the desk uses.
 * Returns canonical symbol + exchange (e.g. BTC/USD+CRYPTO, DANGCEM+NGX).
 */
export async function verifyTradableSymbol(
  symbol: string,
  exchangeHint?: string,
): Promise<string> {
  const verified = await verifyTradableSymbolDetailed(symbol, exchangeHint);
  return verified.symbol;
}

export async function verifyTradableSymbolDetailed(
  symbol: string,
  exchangeHint?: string,
): Promise<VerifiedSymbol> {
  const resolved = resolveSymbolInput(symbol, exchangeHint);
  if (!resolved.symbol) {
    throw new MarketDataError("Symbol is required");
  }
  if (resolved.unsupportedCrypto) {
    throw new MarketDataError(
      `Unsupported crypto ${resolved.symbol}. Supported pairs: ${listSupportedCryptoPairs().join(", ")} — symbol was not added.`,
    );
  }

  const tryFetch = async (sym: string, exchange?: string) => {
    const series = await fetchDailyOhlc(sym, 15, exchange);
    if (!series.bars.length) {
      throw new MarketDataError(
        `No market history for ${sym} — check the ticker and try again`,
      );
    }
    return series.symbol || sym;
  };

  try {
    if (resolved.assetClass === "forex" || resolved.assetClass === "commodity") {
      const canonical = await tryFetch(resolved.symbol, resolved.exchange);
      return { symbol: canonical, exchange: resolved.exchange };
    }

    if (isNgxExchange(resolved.exchange) || isKnownNgxTicker(resolved.symbol)) {
      const canonical = await tryFetch(resolved.symbol, "NGX");
      return { symbol: canonical, exchange: "NGX" };
    }

    try {
      const canonical = await tryFetch(resolved.symbol, resolved.exchange);
      return {
        symbol: canonical,
        exchange: defaultExchangeForSymbol(canonical),
      };
    } catch (usError) {
      if (
        hasNgnMarketCredentials() &&
        (await isListedOnNgx(resolved.symbol))
      ) {
        const canonical = await tryFetch(resolved.symbol, "NGX");
        return { symbol: canonical, exchange: "NGX" };
      }
      throw usError;
    }
  } catch (error) {
    if (error instanceof MarketDataError) {
      const msg = error.message;
      if (/\b403\b/.test(msg) || /forbidden/i.test(msg)) {
        throw new MarketDataError(
          `Market data blocked for ${resolved.symbol} (forbidden). Symbol was not added.`,
        );
      }
      throw new MarketDataError(
        msg.includes("not added") ? msg : `${msg} — symbol was not added.`,
      );
    }
    throw new MarketDataError(
      `Could not verify ${resolved.symbol} — symbol was not added. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Convert an NGX NGN mark into USD for the shared paper cash ledger. */
export async function toPaperUsdPrice(
  price: number,
  exchange: string,
): Promise<number> {
  if (!isNgxExchange(exchange)) return price;
  try {
    return await convertNgnToUsd(price);
  } catch (error) {
    throw new MarketDataError(
      `Could not convert NGN→USD for paper marks: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export {
  defaultExchangeForSymbol,
  isCommodityPair,
  isCryptoPair,
  isForexPair,
  isMacroPair,
  isNgxExchange,
  listSupportedCommodityPairs,
  listSupportedCryptoPairs,
  listSupportedFxPairs,
  listSupportedMacroPairs,
  resolveSymbolInput,
};

interface FinnhubSentimentResponse {
  symbol?: string;
  companyNewsScore?: number;
  sentiment?: {
    bullishPercent?: number;
    bearishPercent?: number;
  };
}

export async function fetchNewsSentiment(
  symbol: string,
): Promise<NewsSentiment | null> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return null;
  }

  const cacheKey = `cache:sentiment:${symbol.toUpperCase()}`;
  const cached = await cacheGet<NewsSentiment>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    await acquireFinnhubSlot();
    const url = new URL(`${FINNHUB_BASE}/news-sentiment`);
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("token", token);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      logger.warn("market", "sentiment fetch failed", {
        symbol,
        status: response.status,
      });
      return null;
    }

    const payload = (await response.json()) as FinnhubSentimentResponse;
    if (typeof payload.companyNewsScore !== "number") {
      return null;
    }

    const result: NewsSentiment = {
      symbol: symbol.toUpperCase(),
      companyNewsScore: payload.companyNewsScore,
      bullishPercent: payload.sentiment?.bullishPercent ?? 0,
      bearishPercent: payload.sentiment?.bearishPercent ?? 0,
    };
    await cacheSet(cacheKey, result, SENTIMENT_CACHE_TTL);
    return result;
  } catch (error) {
    logger.error("market", "sentiment error", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface FinnhubCompanyNewsItem {
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
}

/** Recent company headlines from Finnhub (last N days). */
export async function fetchCompanyNews(
  symbol: string,
  lookbackDays = 3,
  limit = 3,
): Promise<CompanyNewsItem[]> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return [];
  }

  const cacheKey = `cache:news:${symbol.toUpperCase()}:${lookbackDays}`;
  const cached = await cacheGet<CompanyNewsItem[]>(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  try {
    await acquireFinnhubSlot();
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - lookbackDays);

    const url = new URL(`${FINNHUB_BASE}/company-news`);
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("from", isoDay(from));
    url.searchParams.set("to", isoDay(to));
    url.searchParams.set("token", token);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      logger.warn("market", "company news failed", {
        symbol,
        status: response.status,
      });
      return [];
    }

    const payload = (await response.json()) as FinnhubCompanyNewsItem[];
    if (!Array.isArray(payload)) {
      return [];
    }

    const items: CompanyNewsItem[] = payload
      .filter((item) => item.headline)
      .slice(0, 10)
      .map((item) => ({
        headline: item.headline ?? "",
        summary: item.summary ?? "",
        source: item.source ?? "",
        url: item.url ?? "",
        datetime: item.datetime ?? 0,
      }));

    await cacheSet(cacheKey, items, NEWS_CACHE_TTL);
    return items.slice(0, limit);
  } catch (error) {
    logger.error("market", "company news error", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Crypto headlines via Finnhub market news (category=crypto), filtered to the coin.
 * Isolated from /company-news so equity paths stay untouched.
 */
export async function fetchCryptoMarketNews(
  symbol: string,
  limit = 3,
): Promise<CompanyNewsItem[]> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return [];
  }

  const resolved = resolveSymbolInput(symbol, "CRYPTO");
  if (resolved.unsupportedCrypto || !isCryptoPair(resolved.symbol)) {
    return [];
  }
  const pair = resolved.symbol;
  const needles = cryptoNewsNeedles(pair);
  const cacheKey = `cache:news:crypto:${pair}:${limit}`;
  const cached = await cacheGet<CompanyNewsItem[]>(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  try {
    await acquireFinnhubSlot();
    const url = new URL(`${FINNHUB_BASE}/news`);
    url.searchParams.set("category", "crypto");
    url.searchParams.set("token", token);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      logger.warn("market", "crypto market news failed", {
        symbol: pair,
        status: response.status,
      });
      return [];
    }

    const payload = (await response.json()) as FinnhubCompanyNewsItem[];
    if (!Array.isArray(payload)) {
      return [];
    }

    const matches = (text: string) => {
      const hay = text.toLowerCase();
      return needles.some((n) => {
        if (n.length <= 3) {
          const re = new RegExp(
            `(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
            "i",
          );
          return re.test(hay);
        }
        return hay.includes(n);
      });
    };

    const filtered = payload
      .filter((item) => item.headline)
      .filter(
        (item) =>
          matches(item.headline ?? "") || matches(item.summary ?? ""),
      )
      .map((item) => ({
        headline: item.headline ?? "",
        summary: item.summary ?? "",
        source: item.source ?? "",
        url: item.url ?? "",
        datetime: item.datetime ?? 0,
      }));

    // Prefer coin hits; if none match, fall back to a few general crypto headlines
    // so the tape does not look "broken" vs equities.
    const items =
      filtered.length > 0
        ? filtered.slice(0, Math.max(limit, 10))
        : payload
            .filter((item) => item.headline)
            .slice(0, Math.max(limit, 10))
            .map((item) => ({
              headline: item.headline ?? "",
              summary: item.summary ?? "",
              source: item.source ?? "",
              url: item.url ?? "",
              datetime: item.datetime ?? 0,
            }));

    await cacheSet(cacheKey, items, NEWS_CACHE_TTL);
    return items.slice(0, limit);
  } catch (error) {
    logger.error("market", "crypto market news error", {
      symbol: pair,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * FX / commodity headlines via Finnhub market news (category=forex), keyword-filtered.
 */
export async function fetchMacroMarketNews(
  symbol: string,
  limit = 3,
): Promise<CompanyNewsItem[]> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return [];
  }

  const resolved = resolveSymbolInput(symbol);
  if (!isMacroPair(resolved.symbol)) {
    return [];
  }

  const pair = resolved.symbol;
  const needles = macroNewsNeedles(pair);
  const cacheKey = `cache:news:macro:${pair}:${limit}`;
  const cached = await cacheGet<CompanyNewsItem[]>(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  try {
    await acquireFinnhubSlot();
    const url = new URL(`${FINNHUB_BASE}/news`);
    url.searchParams.set("category", "forex");
    url.searchParams.set("token", token);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      logger.warn("market", "forex market news failed", {
        symbol: pair,
        status: response.status,
      });
      return [];
    }

    const payload = (await response.json()) as FinnhubCompanyNewsItem[];
    if (!Array.isArray(payload)) {
      return [];
    }

    const matches = (text: string) => {
      const hay = text.toLowerCase();
      return needles.some((n) => {
        if (n.length <= 3) {
          const re = new RegExp(
            `(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
            "i",
          );
          return re.test(hay);
        }
        return hay.includes(n);
      });
    };

    const filtered = payload
      .filter((item) => item.headline)
      .filter(
        (item) =>
          matches(item.headline ?? "") || matches(item.summary ?? ""),
      )
      .map((item) => ({
        headline: item.headline ?? "",
        summary: item.summary ?? "",
        source: item.source ?? "",
        url: item.url ?? "",
        datetime: item.datetime ?? 0,
      }));

    const items =
      filtered.length > 0
        ? filtered.slice(0, Math.max(limit, 10))
        : payload
            .filter((item) => item.headline)
            .slice(0, Math.max(limit, 10))
            .map((item) => ({
              headline: item.headline ?? "",
              summary: item.summary ?? "",
              source: item.source ?? "",
              url: item.url ?? "",
              datetime: item.datetime ?? 0,
            }));

    await cacheSet(cacheKey, items, NEWS_CACHE_TTL);
    return items.slice(0, limit);
  } catch (error) {
    logger.error("market", "macro market news error", {
      symbol: pair,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Equity → company-news; crypto → Finnhub crypto; macro → forex feed; NGX → NGN Market. */
export async function fetchHeadlinesForSymbol(
  symbol: string,
  limit = 3,
  exchangeHint?: string,
): Promise<CompanyNewsItem[]> {
  const resolved = resolveSymbolInput(symbol, exchangeHint);
  if (isCryptoPair(symbol) || resolved.assetClass === "crypto") {
    return fetchCryptoMarketNews(symbol, limit);
  }
  if (resolved.assetClass === "forex" || resolved.assetClass === "commodity") {
    return fetchMacroMarketNews(resolved.symbol, limit);
  }
  if (
    isNgxExchange(resolved.exchange) ||
    isNgxExchange(exchangeHint) ||
    isKnownNgxTicker(resolved.symbol)
  ) {
    return fetchNgxCompanyNews(resolved.symbol, limit);
  }
  return fetchCompanyNews(resolved.symbol, 3, limit);
}

export function buildMarketSnapshot(
  series: CandleSeries,
  exchange: string,
  sentiment: NewsSentiment | null,
  headlines: CompanyNewsItem[] = [],
): MarketSnapshot {
  const { bars, symbol } = series;
  if (bars.length === 0) {
    throw new MarketDataError(`Empty bars for ${symbol}`);
  }

  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const current = bars[bars.length - 1];
  const previous = bars.length > 1 ? bars[bars.length - 2] : current;

  const sma14 = calculateSMA(closes, SMA_PERIOD);
  const avgVolume20 = calculateAverageVolume(volumes, VOLUME_AVG_PERIOD);
  const pctBelowSma14 = ((sma14 - current.close) / sma14) * 100;
  const changePct =
    previous.close === 0
      ? 0
      : ((current.close - previous.close) / previous.close) * 100;
  const volumeRatio = avgVolume20 === 0 ? 0 : current.volume / avgVolume20;

  return {
    symbol,
    exchange: exchange.toUpperCase(),
    currentPrice: current.close,
    sma14,
    pctBelowSma14,
    changePct,
    volume: current.volume,
    avgVolume20,
    volumeRatio,
    sentimentScore: sentiment?.companyNewsScore ?? null,
    closes,
    volumes,
    headlines,
  };
}

export function isSharpDip(snapshot: MarketSnapshot): boolean {
  return snapshot.pctBelowSma14 >= DIP_THRESHOLD_PCT;
}

export function isPromisingBreakout(snapshot: MarketSnapshot): boolean {
  const volumeSurge = snapshot.volumeRatio >= VOLUME_SURGE_RATIO;
  if (!volumeSurge) {
    return false;
  }

  if (snapshot.sentimentScore === null) {
    return snapshot.changePct > 0;
  }

  return snapshot.sentimentScore >= 0 && snapshot.changePct > 0;
}

export {
  DIP_THRESHOLD_PCT,
  MarketDataError,
  SMA_PERIOD,
  VOLUME_AVG_PERIOD,
  VOLUME_SURGE_RATIO,
};
