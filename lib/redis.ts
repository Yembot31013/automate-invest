import { Redis } from "@upstash/redis";

import type { PaperPosition, WatchlistEntry } from "@/types";

const SYSTEM_WATCHLIST_KEY = "watchlist:system";
const LEGACY_WATCHLIST_KEY = "watchlist";
const ALERT_TTL_SECONDS = 60 * 60 * 24;
const CHAT_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEFAULT_PAPER_CASH = 100_000;

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = Redis.fromEnv();
  }
  return redisClient;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function userWatchlistKey(userId: string): string {
  return `user:${userId}:watchlist`;
}

function userPaperKey(userId: string): string {
  return `user:${userId}:paper:positions`;
}

function userCashKey(userId: string): string {
  return `user:${userId}:paper:cash`;
}

function userChatKey(userId: string): string {
  return `user:${userId}:chat:default`;
}

function symbolWatchersKey(symbol: string): string {
  return `symbol:${normalizeSymbol(symbol)}:watchers`;
}

function alertKey(symbol: string, type: string): string {
  return `alert:${normalizeSymbol(symbol)}:${type}`;
}

export async function wasAlertedRecently(
  symbol: string,
  type: string,
): Promise<boolean> {
  const existing = await getRedis().get<string>(alertKey(symbol, type));
  return existing !== null && existing !== undefined;
}

export async function markAlertSent(
  symbol: string,
  type: string,
): Promise<void> {
  await getRedis().set(alertKey(symbol, type), new Date().toISOString(), {
    ex: ALERT_TTL_SECONDS,
  });
}

async function readWatchlist(key: string): Promise<WatchlistEntry[]> {
  const raw = await getRedis().get<WatchlistEntry[]>(key);
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw;
}

async function writeWatchlist(
  key: string,
  list: WatchlistEntry[],
): Promise<void> {
  await getRedis().set(key, list);
}

async function rebuildSystemWatchlist(): Promise<WatchlistEntry[]> {
  const redis = getRedis();
  const system = await readWatchlist(SYSTEM_WATCHLIST_KEY);
  // Prefer explicit system entries that still have watchers.
  const kept: WatchlistEntry[] = [];
  for (const entry of system) {
    const watchers = await redis.smembers(symbolWatchersKey(entry.symbol));
    if (watchers.length > 0) {
      kept.push(entry);
    }
  }
  await writeWatchlist(SYSTEM_WATCHLIST_KEY, kept);
  return kept;
}

/** Union of actively watched symbols for the cron scanner. */
export async function getSystemWatchlist(): Promise<WatchlistEntry[]> {
  const system = await readWatchlist(SYSTEM_WATCHLIST_KEY);
  if (system.length > 0) {
    return system;
  }
  return readWatchlist(LEGACY_WATCHLIST_KEY);
}

export async function getUserWatchlist(
  userId: string,
): Promise<WatchlistEntry[]> {
  return readWatchlist(userWatchlistKey(userId));
}

/**
 * Add to the user's watchlist, register as a watcher, and ensure cron coverage.
 */
export async function addToUserWatchlist(
  userId: string,
  symbol: string,
  exchange = "NASDAQ",
): Promise<WatchlistEntry[]> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    throw new Error("Symbol is required");
  }

  const redis = getRedis();
  const list = await getUserWatchlist(userId);
  let next = list;
  const exchangeLabel = exchange.trim().toUpperCase() || "NASDAQ";

  if (!list.some((entry) => entry.symbol === normalized)) {
    next = [
      ...list,
      {
        symbol: normalized,
        exchange: exchangeLabel,
        addedAt: new Date().toISOString(),
      },
    ];
    await writeWatchlist(userWatchlistKey(userId), next);
  }

  await redis.sadd(symbolWatchersKey(normalized), userId);

  const system = await getSystemWatchlist();
  if (!system.some((entry) => entry.symbol === normalized)) {
    await writeWatchlist(SYSTEM_WATCHLIST_KEY, [
      ...system.filter((e) => e.symbol !== normalized),
      {
        symbol: normalized,
        exchange: exchangeLabel,
        addedAt: new Date().toISOString(),
      },
    ]);
  }

  return next;
}

/**
 * Remove from the user's list. Drop from cron only when no watchers remain.
 */
export async function removeFromUserWatchlist(
  userId: string,
  symbol: string,
): Promise<WatchlistEntry[]> {
  const normalized = normalizeSymbol(symbol);
  const redis = getRedis();
  const list = await getUserWatchlist(userId);
  const next = list.filter((entry) => entry.symbol !== normalized);
  await writeWatchlist(userWatchlistKey(userId), next);
  await redis.srem(symbolWatchersKey(normalized), userId);

  const remaining = await redis.smembers(symbolWatchersKey(normalized));
  if (remaining.length === 0) {
    const system = await getSystemWatchlist();
    await writeWatchlist(
      SYSTEM_WATCHLIST_KEY,
      system.filter((entry) => entry.symbol !== normalized),
    );
  }

  return next;
}

export async function getPaperPositions(
  userId: string,
): Promise<PaperPosition[]> {
  const raw = await getRedis().get<PaperPosition[]>(userPaperKey(userId));
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw;
}

export async function savePaperPositions(
  userId: string,
  positions: PaperPosition[],
): Promise<void> {
  await getRedis().set(userPaperKey(userId), positions);
}

export async function getPaperCash(userId: string): Promise<number> {
  const raw = await getRedis().get<number>(userCashKey(userId));
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  await getRedis().set(userCashKey(userId), DEFAULT_PAPER_CASH);
  return DEFAULT_PAPER_CASH;
}

export async function setPaperCash(
  userId: string,
  cash: number,
): Promise<void> {
  await getRedis().set(userCashKey(userId), cash);
}

export async function getChatMessages<T>(userId: string): Promise<T[]> {
  const raw = await getRedis().get<T[]>(userChatKey(userId));
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw;
}

export async function saveChatMessages<T>(
  userId: string,
  messages: T[],
): Promise<void> {
  const trimmed = messages.slice(-80);
  await getRedis().set(userChatKey(userId), trimmed, { ex: CHAT_TTL_SECONDS });
}

/** Wipe persisted sidekick thread for this user (watchlist/paper untouched). */
export async function clearChatMessages(userId: string): Promise<void> {
  await getRedis().del(userChatKey(userId));
}

export {
  ALERT_TTL_SECONDS,
  DEFAULT_PAPER_CASH,
  SYSTEM_WATCHLIST_KEY,
  rebuildSystemWatchlist,
};
