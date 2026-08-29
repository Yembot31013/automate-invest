import { Redis } from "@upstash/redis";

import type { WatchlistEntry } from "@/types";

const WATCHLIST_KEY = "watchlist";
const ALERT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

let redisClient: Redis | null = null;

/**
 * Lazy Upstash Redis client (REST).
 * Expects UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 * Lazy init avoids build-time crashes when env vars are absent.
 */
export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = Redis.fromEnv();
  }
  return redisClient;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function alertKey(symbol: string, type: string): string {
  return `alert:${normalizeSymbol(symbol)}:${type}`;
}

/** Returns true when an alert of this type was already sent within 24h. */
export async function wasAlertedRecently(
  symbol: string,
  type: string,
): Promise<boolean> {
  const existing = await getRedis().get<string>(alertKey(symbol, type));
  return existing !== null && existing !== undefined;
}

/** Persist a suppression flag so Discord is not spammed for 24 hours. */
export async function markAlertSent(
  symbol: string,
  type: string,
): Promise<void> {
  await getRedis().set(alertKey(symbol, type), new Date().toISOString(), {
    ex: ALERT_TTL_SECONDS,
  });
}

export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const raw = await getRedis().get<WatchlistEntry[]>(WATCHLIST_KEY);
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw;
}

export async function addToWatchlist(
  symbol: string,
  exchange = "NASDAQ",
): Promise<WatchlistEntry[]> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    throw new Error("Symbol is required");
  }

  const list = await getWatchlist();
  if (list.some((entry) => entry.symbol === normalized)) {
    return list;
  }

  const next: WatchlistEntry[] = [
    ...list,
    {
      symbol: normalized,
      exchange: exchange.trim().toUpperCase() || "NASDAQ",
      addedAt: new Date().toISOString(),
    },
  ];

  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export async function removeFromWatchlist(
  symbol: string,
): Promise<WatchlistEntry[]> {
  const normalized = normalizeSymbol(symbol);
  const list = await getWatchlist();
  const next = list.filter((entry) => entry.symbol !== normalized);
  await getRedis().set(WATCHLIST_KEY, next);
  return next;
}

export { ALERT_TTL_SECONDS, WATCHLIST_KEY };
