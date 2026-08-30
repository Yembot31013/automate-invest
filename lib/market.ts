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
  defaultExchangeForSymbol,
  isCryptoPair,
  resolveSymbolInput,
} from "@/lib/symbols";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2";
const ALPACA_CRYPTO_BARS = "https://data.alpaca.markets/v1beta3/crypto/us/bars";

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
  const pair = resolveSymbolInput(symbol, "CRYPTO").symbol;
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

function hasAlpacaCredentials(): boolean {
  return Boolean(
    process.env.ALPACA_API_KEY?.trim() &&
      process.env.ALPACA_API_SECRET?.trim(),
  );
}

/**
 * Daily OHLC for desk math (SMA, volume ratio, dip %).
 * Crypto pairs use Alpaca spot; equities prefer Alpaca then Finnhub candles.
 */
export async function fetchDailyOhlc(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  if (isCryptoPair(symbol) || resolveSymbolInput(symbol).assetClass === "crypto") {
    if (!hasAlpacaCredentials()) {
      throw new MarketDataError(
        "Crypto spot needs ALPACA_API_KEY/SECRET configured",
      );
    }
    return fetchAlpacaCryptoBars(symbol, lookbackDays);
  }

  const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY?.trim());
  const hasAlpaca = hasAlpacaCredentials();

  if (hasAlpaca) {
    try {
      return await fetchAlpacaDailyBars(symbol, lookbackDays);
    } catch (error) {
      if (!hasFinnhub) throw error;
      logger.warn("market", "Alpaca OHLC failed; trying Finnhub candles", {
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (hasFinnhub) {
    return fetchFinnhubDailyCandles(symbol, lookbackDays);
  }

  throw new MarketDataError(
    "No market data credentials configured (ALPACA_API_KEY/SECRET or FINNHUB_API_KEY)",
  );
}

/**
 * Confirm a ticker resolves with the same OHLC path the desk uses.
 * Returns the canonical symbol (e.g. BTC/USD for bitcoin). Throws MarketDataError.
 */
export async function verifyTradableSymbol(symbol: string): Promise<string> {
  const resolved = resolveSymbolInput(symbol);
  if (!resolved.symbol) {
    throw new MarketDataError("Symbol is required");
  }

  try {
    const series = await fetchDailyOhlc(resolved.symbol, 15);
    if (!series.bars.length) {
      throw new MarketDataError(
        `No market history for ${resolved.symbol} — check the ticker and try again`,
      );
    }
    return series.symbol || resolved.symbol;
  } catch (error) {
    if (error instanceof MarketDataError) {
      const msg = error.message;
      if (/\b403\b/.test(msg) || /forbidden/i.test(msg)) {
        throw new MarketDataError(
          `Market data blocked for ${resolved.symbol} (forbidden). Symbol was not added.`,
        );
      }
      throw new MarketDataError(
        msg.includes("not added")
          ? msg
          : `${msg} — symbol was not added.`,
      );
    }
    throw new MarketDataError(
      `Could not verify ${resolved.symbol} — symbol was not added. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export { defaultExchangeForSymbol, isCryptoPair, resolveSymbolInput };

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
