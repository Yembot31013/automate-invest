/** Alert classification for Discord theming and Redis suppression keys. */
export type AlertType = "dip" | "breakout";

/** Single daily OHLC bar used across market math and charting. */
export interface OhlcBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Normalized candle series returned by market data providers. */
export interface CandleSeries {
  symbol: string;
  bars: OhlcBar[];
}

/** Finnhub news-sentiment summary (subset of the public API). */
export interface NewsSentiment {
  symbol: string;
  /** Aggregate bullish/bearish score in roughly [-1, 1]. */
  companyNewsScore: number;
  bullishPercent: number;
  bearishPercent: number;
}

/** Derived metrics used by anomaly rules and Discord embeds. */
export interface MarketSnapshot {
  symbol: string;
  exchange: string;
  currentPrice: number;
  sma14: number;
  /** Percent below the 14-day SMA (positive = trading under the average). */
  pctBelowSma14: number;
  /** Percent change vs previous close. */
  changePct: number;
  volume: number;
  avgVolume20: number;
  /** Current volume / 20-day average volume. */
  volumeRatio: number;
  sentimentScore: number | null;
  closes: number[];
  volumes: number[];
}

/** Payload handed to the Discord embed builder after a rule fires. */
export interface AlertPayload {
  type: AlertType;
  snapshot: MarketSnapshot;
  title: string;
  description: string;
}

/** Redis-backed watchlist entry. */
export interface WatchlistEntry {
  symbol: string;
  exchange: string;
  addedAt: string;
}

/** Discord embed field (API shape). */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Discord embed object (API shape). */
export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordEmbedField[];
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
  author?: { name: string };
}

/** Outbound Discord webhook body. */
export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  embeds: DiscordEmbed[];
}

/** Cron scan summary returned to Vercel. */
export interface ScanResult {
  scanned: number;
  alerted: string[];
  skipped: string[];
  errors: Array<{ symbol: string; message: string }>;
}

/** Watchlist mutation request body. */
export interface WatchlistMutationBody {
  symbol: string;
  exchange?: string;
  action?: "add" | "remove";
}
