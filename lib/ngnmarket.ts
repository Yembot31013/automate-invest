import { cacheGet, cacheSet } from "@/lib/cache";
import { logger } from "@/lib/logger";

const NGN_MARKET_BASE = "https://api.ngnmarket.com/v1";
const IDENTIFIERS_CACHE_TTL = 60 * 60 * 12; // 12h
const FOREX_CACHE_TTL = 60 * 60; // 1h
const CHART_CACHE_TTL = 300;
const NEWS_CACHE_TTL = 300;

export class NgnMarketError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "NgnMarketError";
  }
}

type Envelope<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; required_plan?: string };
  meta?: unknown;
};

function apiKey(): string | null {
  return process.env.NGNMARKET_API_KEY?.trim() || null;
}

export function hasNgnMarketCredentials(): boolean {
  return Boolean(apiKey());
}

async function ngnFetch<T>(
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<T> {
  const key = apiKey();
  if (!key) {
    throw new NgnMarketError("Missing NGNMARKET_API_KEY");
  }

  const url = new URL(`${NGN_MARKET_BASE}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const code = payload?.error?.code;
    const message =
      payload?.error?.message ||
      `NGN Market ${path} failed: ${response.status} ${response.statusText}`;
    throw new NgnMarketError(message, response.status, code);
  }

  if (payload?.data == null) {
    throw new NgnMarketError(`NGN Market ${path} returned empty data`);
  }

  return payload.data;
}

export type NgxIdentifier = {
  symbol: string;
  name: string;
};

type IdentifiersPayload = {
  data?: Array<{ symbol?: string; name?: string }>;
  count?: number;
};

/** Cached NGX ticker → company name map (Free plan). */
export async function fetchNgxIdentifierMap(): Promise<Map<string, string>> {
  const cacheKey = "cache:ngn:identifiers:v1";
  const cached = await cacheGet<Record<string, string>>(cacheKey);
  if (cached && Object.keys(cached).length > 0) {
    return new Map(Object.entries(cached));
  }

  const payload = await ngnFetch<IdentifiersPayload>("/companies/identifiers");
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const map = new Map<string, string>();
  for (const row of rows) {
    const symbol = row.symbol?.trim().toUpperCase();
    if (!symbol) continue;
    map.set(symbol, row.name?.trim() || symbol);
  }

  if (map.size === 0) {
    throw new NgnMarketError("NGN Market identifiers returned no tickers");
  }

  await cacheSet(cacheKey, Object.fromEntries(map), IDENTIFIERS_CACHE_TTL);
  return map;
}

export async function isListedOnNgx(symbol: string): Promise<boolean> {
  if (!hasNgnMarketCredentials()) return false;
  try {
    const map = await fetchNgxIdentifierMap();
    return map.has(symbol.trim().toUpperCase());
  } catch (error) {
    logger.warn("ngnmarket", "identifier lookup failed", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

type ChartDetailedPoint = {
  timestamp?: number;
  date?: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  price?: number | null;
  volume?: number | null;
};

type ChartPayload = {
  symbol?: string;
  data?: ChartDetailedPoint[];
  count?: number;
};

export type NgxOhlcBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CompanyListPayload = {
  data?: Array<{
    symbol?: string;
    name?: string;
    price?: number;
    current_price?: number;
    prev_close?: number;
    day_high?: number;
    day_low?: number;
    volume?: number;
    last_updated?: string;
  }>;
};

export type NgxLiveQuote = {
  symbol: string;
  name?: string;
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
};

/** Live quote via Free-tier company list search. */
export async function fetchNgxLiveQuote(symbol: string): Promise<NgxLiveQuote> {
  const ticker = symbol.trim().toUpperCase();
  const cacheKey = `cache:ngn:quote:${ticker}`;
  const cached = await cacheGet<NgxLiveQuote>(cacheKey);
  if (cached?.price) return cached;

  const payload = await ngnFetch<CompanyListPayload>("/companies", {
    search: ticker,
    limit: 20,
  });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const match =
    rows.find((row) => row.symbol?.trim().toUpperCase() === ticker) ?? rows[0];

  const price = match?.price ?? match?.current_price;
  if (!match?.symbol || price == null || !Number.isFinite(price) || price <= 0) {
    throw new NgnMarketError(`No NGX live quote for ${ticker}`, 404, "NOT_FOUND");
  }

  const prevClose =
    match.prev_close != null && Number.isFinite(match.prev_close) && match.prev_close > 0
      ? match.prev_close
      : price;
  const dayHigh =
    match.day_high != null && Number.isFinite(match.day_high) ? match.day_high : price;
  const dayLow =
    match.day_low != null && Number.isFinite(match.day_low) ? match.day_low : price;
  const volume =
    match.volume != null && Number.isFinite(match.volume) ? match.volume : 0;

  const quote: NgxLiveQuote = {
    symbol: match.symbol.trim().toUpperCase(),
    name: match.name,
    price,
    prevClose,
    dayHigh,
    dayLow,
    volume,
  };
  await cacheSet(cacheKey, quote, 120);
  return quote;
}

/** Build a short synthetic series so Free-tier quotes still drive desk math. */
function synthesizeBarsFromQuote(
  quote: NgxLiveQuote,
  lookbackDays: number,
): NgxOhlcBar[] {
  const days = Math.max(15, Math.min(lookbackDays, 40));
  const now = Date.now();
  const bars: NgxOhlcBar[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const isLast = i === 0;
    const close = isLast ? quote.price : quote.prevClose;
    const open = quote.prevClose;
    const high = isLast ? Math.max(quote.dayHigh, close, open) : close;
    const low = isLast ? Math.min(quote.dayLow, close, open) : close;
    const volume = isLast ? quote.volume : 0;
    const timestamp = Math.floor((now - i * 24 * 60 * 60 * 1000) / 1000);
    bars.push({ timestamp, open, high, low, close, volume });
  }

  return bars;
}

/** Daily OHLCV in NGN. Chart on Hobby+; Free falls back to live list quote. */
export async function fetchNgxCompanyChart(
  symbol: string,
  lookbackDays = 40,
): Promise<{ symbol: string; bars: NgxOhlcBar[]; source: "chart" | "quote" }> {
  const ticker = symbol.trim().toUpperCase();
  const period =
    lookbackDays <= 7
      ? "7d"
      : lookbackDays <= 30
        ? "30d"
        : lookbackDays <= 90
          ? "90d"
          : "1y";

  const cacheKey = `cache:ngn:chart:${ticker}:${period}`;
  const cached = await cacheGet<{
    symbol: string;
    bars: NgxOhlcBar[];
    source: "chart" | "quote";
  }>(cacheKey);
  if (cached?.bars?.length) {
    return cached;
  }

  try {
    const payload = await ngnFetch<ChartPayload>(
      `/companies/${encodeURIComponent(ticker)}/chart`,
      { period, format: "detailed" },
    );

    const points = Array.isArray(payload.data) ? payload.data : [];
    const bars: NgxOhlcBar[] = [];

    for (const point of points) {
      const close = point.close ?? point.price;
      if (close == null || !Number.isFinite(close)) continue;

      let timestamp = 0;
      if (typeof point.timestamp === "number" && Number.isFinite(point.timestamp)) {
        timestamp =
          point.timestamp > 1e12
            ? Math.floor(point.timestamp / 1000)
            : Math.floor(point.timestamp);
      } else if (point.date) {
        timestamp = Math.floor(new Date(`${point.date}T12:00:00Z`).getTime() / 1000);
      }

      const open = point.open != null && Number.isFinite(point.open) ? point.open : close;
      const high = point.high != null && Number.isFinite(point.high) ? point.high : close;
      const low = point.low != null && Number.isFinite(point.low) ? point.low : close;
      const volume =
        point.volume != null && Number.isFinite(point.volume) ? point.volume : 0;

      bars.push({ timestamp, open, high, low, close, volume });
    }

    if (bars.length === 0) {
      throw new NgnMarketError(`No NGX chart data for ${ticker}`, 404, "NOT_FOUND");
    }

    bars.sort((a, b) => a.timestamp - b.timestamp);
    const series = {
      symbol: payload.symbol?.toUpperCase() || ticker,
      bars,
      source: "chart" as const,
    };
    await cacheSet(cacheKey, series, CHART_CACHE_TTL);
    return series;
  } catch (error) {
    const planBlocked =
      error instanceof NgnMarketError &&
      (error.code === "PLAN_REQUIRED" ||
        error.status === 403 ||
        /starter plan|hobby plan|plan or higher/i.test(error.message));

    if (!planBlocked && !(error instanceof NgnMarketError && error.status === 404)) {
      throw error;
    }

    logger.info("ngnmarket", "chart unavailable; using Free live quote", {
      symbol: ticker,
      error: error instanceof Error ? error.message : String(error),
    });

    const quote = await fetchNgxLiveQuote(ticker);
    const series = {
      symbol: quote.symbol,
      bars: synthesizeBarsFromQuote(quote, lookbackDays),
      source: "quote" as const,
    };
    await cacheSet(cacheKey, series, 120);
    return series;
  }
}

type NewsPayload = {
  company?: string;
  data?: Array<{
    title?: string;
    link?: string;
    source?: string;
    pub_date?: string;
  }>;
  total?: number;
};

export type NgxNewsItem = {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
};

async function fetchNgxBlogHeadlines(
  symbol: string,
  limit: number,
): Promise<NgxNewsItem[]> {
  const ticker = symbol.trim().toUpperCase();
  const fromOfficial = await fetchNgxBlogHeadlinesOfficial(ticker, limit);
  if (fromOfficial.length > 0) return fromOfficial.slice(0, limit);
  return (await fetchNgxBlogHeadlinesWebsite(ticker, limit)).slice(0, limit);
}

/** Developer API blog search (can 500 on some Free accounts). */
async function fetchNgxBlogHeadlinesOfficial(
  ticker: string,
  limit: number,
): Promise<NgxNewsItem[]> {
  try {
    const payload = await ngnFetch<{
      data?: Array<{
        title?: string;
        slug?: string;
        excerpt?: string;
        published_date?: string;
        url?: string;
      }>;
      total?: number;
    }>("/blog/search", {
      q: ticker,
      limit: Math.min(Math.max(limit, 1), 10),
    });
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return mapBlogRows(rows);
  } catch (error) {
    logger.info("ngnmarket", "official blog search unavailable", {
      symbol: ticker,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Public site blog search (no Bearer key). Works when /v1/blog/search 500s.
 * Shape differs slightly from the developer API.
 */
async function fetchNgxBlogHeadlinesWebsite(
  ticker: string,
  limit: number,
): Promise<NgxNewsItem[]> {
  try {
    const url = new URL("https://ngnmarket.com/api/blog/search");
    url.searchParams.set("q", ticker);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SignalDesk/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      logger.info("ngnmarket", "website blog search failed", {
        symbol: ticker,
        status: response.status,
      });
      return [];
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: Array<{
        title?: string;
        slug?: string;
        excerpt?: string;
        date?: string;
        published_date?: string;
        url?: string;
      }>;
    };

    if (payload.success === false || !Array.isArray(payload.data)) {
      return [];
    }

    return mapBlogRows(payload.data);
  } catch (error) {
    logger.info("ngnmarket", "website blog headlines unavailable", {
      symbol: ticker,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function mapBlogRows(
  rows: Array<{
    title?: string;
    slug?: string;
    excerpt?: string;
    date?: string;
    published_date?: string;
    url?: string;
  }>,
): NgxNewsItem[] {
  return rows
    .filter((row) => row.title)
    .map((row) => {
      const dateRaw = row.published_date ?? row.date;
      const pub = dateRaw ? Date.parse(dateRaw) : NaN;
      const slug = row.slug?.trim();
      return {
        headline: row.title ?? "",
        summary: row.excerpt ?? "",
        source: "NGN Market",
        url:
          row.url?.trim() ||
          (slug ? `https://ngnmarket.com/blog/${slug}` : ""),
        datetime: Number.isFinite(pub) ? Math.floor(pub / 1000) : 0,
      };
    });
}

/** Company news (Starter+); Free falls back to blog search. */
export async function fetchNgxCompanyNews(
  symbol: string,
  limit = 3,
): Promise<NgxNewsItem[]> {
  if (!hasNgnMarketCredentials()) return [];

  const ticker = symbol.trim().toUpperCase();
  const cacheKey = `cache:ngn:news:${ticker}:${limit}`;
  const cached = await cacheGet<NgxNewsItem[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  try {
    const payload = await ngnFetch<NewsPayload>(
      `/companies/${encodeURIComponent(ticker)}/news`,
      { limit: Math.min(Math.max(limit, 1), 10), maxAge: 90 },
    );
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const items: NgxNewsItem[] = rows
      .filter((row) => row.title)
      .map((row) => {
        const pub = row.pub_date ? Date.parse(row.pub_date) : NaN;
        return {
          headline: row.title ?? "",
          summary: "",
          source: row.source ?? "NGX news",
          url: row.link ?? "",
          datetime: Number.isFinite(pub) ? Math.floor(pub / 1000) : 0,
        };
      });

    await cacheSet(cacheKey, items, NEWS_CACHE_TTL);
    return items.slice(0, limit);
  } catch (error) {
    const planBlocked =
      error instanceof NgnMarketError &&
      (error.code === "PLAN_REQUIRED" ||
        error.status === 403 ||
        /starter plan|plan or higher/i.test(error.message));

    logger.info("ngnmarket", "company news gated; trying blog search", {
      symbol: ticker,
      planBlocked,
      error: error instanceof Error ? error.message : String(error),
    });

    const fallback = await fetchNgxBlogHeadlines(ticker, limit);
    await cacheSet(cacheKey, fallback, NEWS_CACHE_TTL);
    return fallback.slice(0, limit);
  }
}

type ForexPayload = {
  target?: string;
  date?: string;
  rates?: Array<{
    currency?: string;
    rate?: number;
    inverse_rate?: number | null;
    daily_change?: number | null;
    daily_change_percent?: number | null;
    last_updated?: string;
  }>;
};

export type NgxForexQuote = {
  /** Foreign currency code, e.g. USD */
  currency: string;
  /** NGN per 1 unit of foreign currency (e.g. 1603.5 means $1 = ₦1603.5) */
  ngnPerUnit: number;
  /** Foreign units per 1 NGN */
  unitPerNgn: number;
  asOf: string | null;
  dailyChangePercent: number | null;
};

/** Live NGN cross vs a foreign currency (Free plan). Default USD. */
export async function fetchNgxForexQuote(
  currency = "USD",
): Promise<NgxForexQuote> {
  const code = currency.trim().toUpperCase() || "USD";
  const cacheKey = `cache:ngn:forex:quote:${code}`;
  const cached = await cacheGet<NgxForexQuote>(cacheKey);
  if (cached != null && cached.ngnPerUnit > 0) return cached;

  const payload = await ngnFetch<ForexPayload>("/forex/current");
  const row = payload.rates?.find((r) => r.currency?.toUpperCase() === code);
  if (!row) {
    const available =
      payload.rates
        ?.map((r) => r.currency?.toUpperCase())
        .filter(Boolean)
        .slice(0, 12)
        .join(", ") || "none";
    throw new NgnMarketError(
      `No NGN rate for ${code}. Available: ${available}`,
      404,
      "NOT_FOUND",
    );
  }

  let ngnPerUnit = 0;
  let unitPerNgn = 0;
  if (row.rate != null && row.rate > 0) {
    ngnPerUnit = row.rate;
    unitPerNgn =
      row.inverse_rate != null && row.inverse_rate > 0
        ? row.inverse_rate
        : 1 / row.rate;
  } else if (row.inverse_rate != null && row.inverse_rate > 0) {
    unitPerNgn = row.inverse_rate;
    ngnPerUnit = 1 / row.inverse_rate;
  }

  if (!(ngnPerUnit > 0) || !(unitPerNgn > 0)) {
    throw new NgnMarketError(`Invalid NGN/${code} rate`);
  }

  const quote: NgxForexQuote = {
    currency: code,
    ngnPerUnit,
    unitPerNgn,
    asOf: row.last_updated ?? payload.date ?? null,
    dailyChangePercent:
      row.daily_change_percent != null && Number.isFinite(row.daily_change_percent)
        ? row.daily_change_percent
        : null,
  };
  await cacheSet(cacheKey, quote, FOREX_CACHE_TTL);
  return quote;
}

/**
 * USD per 1 NGN (inverse of NGN-per-USD).
 * Used so paper book can keep a single USD cash ledger.
 */
export async function fetchUsdPerNgn(): Promise<number> {
  const quote = await fetchNgxForexQuote("USD");
  return quote.unitPerNgn;
}

export async function convertNgnToUsd(amountNgn: number): Promise<number> {
  const rate = await fetchUsdPerNgn();
  return amountNgn * rate;
}

/** Convert an NGN amount into a foreign currency (default USD). */
export async function convertNgnToForeign(
  amountNgn: number,
  currency = "USD",
): Promise<{ amount: number; quote: NgxForexQuote }> {
  const quote = await fetchNgxForexQuote(currency);
  return { amount: amountNgn * quote.unitPerNgn, quote };
}

/** Convert a foreign amount into NGN (default USD). */
export async function convertForeignToNgn(
  amountForeign: number,
  currency = "USD",
): Promise<{ amountNgn: number; quote: NgxForexQuote }> {
  const quote = await fetchNgxForexQuote(currency);
  return { amountNgn: amountForeign * quote.ngnPerUnit, quote };
}
