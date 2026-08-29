import type {
  CandleSeries,
  MarketSnapshot,
  NewsSentiment,
  OhlcBar,
} from "@/types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2";

const DEFAULT_LOOKBACK_DAYS = 40;
const SMA_PERIOD = 14;
const VOLUME_AVG_PERIOD = 20;
const DIP_THRESHOLD_PCT = 8;
const VOLUME_SURGE_RATIO = 2;

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

/**
 * Pure TypeScript simple moving average over the trailing `period` values.
 * No native / binary TA libraries — serverless-safe array reduction only.
 */
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
      throw new MarketDataError("Cannot calculate SMA: non-finite value in series");
    }
    return acc + value;
  }, 0);

  return sum / period;
}

/** Trailing average of volume (same pure-array approach as SMA). */
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

/** Daily OHLC via Finnhub stock candles. */
export async function fetchFinnhubDailyCandles(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
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
  return mapFinnhubCandles(symbol.toUpperCase(), payload);
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

/** Daily OHLC via Alpaca Market Data API (fallback / alternate provider). */
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

/**
 * Prefer Finnhub when FINNHUB_API_KEY is set; otherwise Alpaca.
 * Throws if neither provider can be configured / returns data.
 */
export async function fetchDailyOhlc(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  if (process.env.FINNHUB_API_KEY?.trim()) {
    return fetchFinnhubDailyCandles(symbol, lookbackDays);
  }
  if (process.env.ALPACA_API_KEY?.trim() && process.env.ALPACA_API_SECRET?.trim()) {
    return fetchAlpacaDailyBars(symbol, lookbackDays);
  }
  throw new MarketDataError(
    "No market data credentials configured (FINNHUB_API_KEY or ALPACA_API_KEY/SECRET)",
  );
}

interface FinnhubSentimentResponse {
  symbol?: string;
  companyNewsScore?: number;
  sentiment?: {
    bullishPercent?: number;
    bearishPercent?: number;
  };
}

/** Company news sentiment from Finnhub (optional — returns null if unavailable). */
export async function fetchNewsSentiment(
  symbol: string,
): Promise<NewsSentiment | null> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return null;
  }

  const url = new URL(`${FINNHUB_BASE}/news-sentiment`);
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("token", token);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[market] sentiment fetch failed for ${symbol}: ${response.status}`,
      );
      return null;
    }

    const payload = (await response.json()) as FinnhubSentimentResponse;
    if (typeof payload.companyNewsScore !== "number") {
      return null;
    }

    return {
      symbol: symbol.toUpperCase(),
      companyNewsScore: payload.companyNewsScore,
      bullishPercent: payload.sentiment?.bullishPercent ?? 0,
      bearishPercent: payload.sentiment?.bearishPercent ?? 0,
    };
  } catch (error) {
    console.error(`[market] sentiment error for ${symbol}:`, error);
    return null;
  }
}

/** Build a snapshot with SMA / volume ratios used by anomaly detectors. */
export function buildMarketSnapshot(
  series: CandleSeries,
  exchange: string,
  sentiment: NewsSentiment | null,
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
  };
}

/** Sharp dip: price ≥ 8% below the 14-day SMA. */
export function isSharpDip(snapshot: MarketSnapshot): boolean {
  return snapshot.pctBelowSma14 >= DIP_THRESHOLD_PCT;
}

/**
 * Under-the-radar breakout: volume ≥ 2× 20-day average and non-negative
 * news sentiment when sentiment data is available.
 */
export function isPromisingBreakout(snapshot: MarketSnapshot): boolean {
  const volumeSurge = snapshot.volumeRatio >= VOLUME_SURGE_RATIO;
  if (!volumeSurge) {
    return false;
  }

  if (snapshot.sentimentScore === null) {
    // Without sentiment, still surface strong structural volume surges.
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
