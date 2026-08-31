import { Redis } from "@upstash/redis";

import { MAX_USER_WATCHLIST } from "@/lib/limits";
import type { PaperPosition, WatchlistEntry } from "@/types";

export class WatchlistLimitError extends Error {
  readonly limit: number;
  readonly current: number;

  constructor(current: number, limit = MAX_USER_WATCHLIST) {
    super(
      `Watchlist is full (${current}/${limit}). Remove a ticker before adding another.`,
    );
    this.name = "WatchlistLimitError";
    this.limit = limit;
    this.current = current;
  }
}

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

function userDeskSettingsKey(userId: string): string {
  return `user:${userId}:desk-settings`;
}

function userTriggersKey(userId: string): string {
  return `user:${userId}:triggers`;
}

function userTriggersLockKey(userId: string): string {
  return `lock:user:${userId}:triggers`;
}

function symbolTriggerUsersKey(symbol: string): string {
  return `symbol:${normalizeSymbol(symbol)}:trigger-users`;
}

function triggerFireKey(userId: string, triggerId: string): string {
  return `trigger-fire:${userId}:${triggerId}`;
}

function userAutoBuyDayKey(userId: string, dayKey: string): string {
  return `user:${userId}:auto-buys:${dayKey}`;
}

function symbolWatchersKey(symbol: string): string {
  return `symbol:${normalizeSymbol(symbol)}:watchers`;
}

function alertKey(symbol: string, type: string): string {
  return `alert:${normalizeSymbol(symbol)}:${type}`;
}

function userWatchlistLockKey(userId: string): string {
  return `lock:user:${userId}:watchlist`;
}

function userPaperLockKey(userId: string): string {
  return `lock:user:${userId}:paper`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withUserLock<T>(
  lockKey: string,
  busyMessage: string,
  fn: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  const maxAttempts = 12;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const acquired = await redis.set(lockKey, "1", { nx: true, ex: 10 });
    if (acquired) {
      try {
        return await fn();
      } finally {
        await redis.del(lockKey);
      }
    }
    await sleep(35 + attempt * 25);
  }

  throw new Error(busyMessage);
}

/** Serialize watchlist writes — parallel tool calls otherwise race and drop symbols. */
async function withUserWatchlistLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withUserLock(
    userWatchlistLockKey(userId),
    "Watchlist is busy — try again in a moment",
    fn,
  );
}

/** Serialize paper book writes — parallel paperSell calls otherwise overwrite each other. */
export async function withUserPaperLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withUserLock(
    userPaperLockKey(userId),
    "Paper book is busy — try again in a moment",
    fn,
  );
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

  return withUserWatchlistLock(userId, async () => {
    const redis = getRedis();
    const list = await getUserWatchlist(userId);
    let next = list;
    const exchangeLabel = exchange.trim().toUpperCase() || "NASDAQ";

    if (!list.some((entry) => entry.symbol === normalized)) {
      if (list.length >= MAX_USER_WATCHLIST) {
        throw new WatchlistLimitError(list.length);
      }
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
  });
}

/**
 * Remove from the user's list. Drop from cron only when no watchers remain.
 */
export async function removeFromUserWatchlist(
  userId: string,
  symbol: string,
): Promise<WatchlistEntry[]> {
  const normalized = normalizeSymbol(symbol);

  return withUserWatchlistLock(userId, async () => {
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
  });
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

export async function getSymbolWatchers(symbol: string): Promise<string[]> {
  const members = await getRedis().smembers(
    symbolWatchersKey(normalizeSymbol(symbol)),
  );
  return members.filter((id) => typeof id === "string" && id.trim());
}

export async function getDeskSettingsRaw(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await getRedis().get<Record<string, unknown>>(
    userDeskSettingsKey(userId),
  );
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

export async function saveDeskSettingsRaw(
  userId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await getRedis().set(userDeskSettingsKey(userId), settings);
}

/** Count auto-buys already taken this UTC day. */
export async function getAutoBuyCountToday(userId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const raw = await getRedis().get<number>(userAutoBuyDayKey(userId, day));
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export async function incrementAutoBuyCountToday(
  userId: string,
): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const key = userAutoBuyDayKey(userId, day);
  const redis = getRedis();
  const next = (await getAutoBuyCountToday(userId)) + 1;
  await redis.set(key, next, { ex: 60 * 60 * 36 });
  return next;
}

const TRIGGERS_COVERAGE_KEY = "triggers:coverage";

export async function getUserTriggersRaw(
  userId: string,
): Promise<unknown[] | null> {
  const raw = await getRedis().get<unknown[]>(userTriggersKey(userId));
  if (!raw || !Array.isArray(raw)) return null;
  return raw;
}

export async function saveUserTriggersRaw(
  userId: string,
  triggers: unknown[],
): Promise<void> {
  await getRedis().set(userTriggersKey(userId), triggers);
}

export async function withUserTriggersLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withUserLock(
    userTriggersLockKey(userId),
    "Triggers are busy — try again in a moment",
    fn,
  );
}

export async function getTriggerCoverage(): Promise<WatchlistEntry[]> {
  return readWatchlist(TRIGGERS_COVERAGE_KEY);
}

export async function saveTriggerCoverage(
  list: WatchlistEntry[],
): Promise<void> {
  await writeWatchlist(TRIGGERS_COVERAGE_KEY, list);
}

export async function addSymbolTriggerUser(
  symbol: string,
  userId: string,
  exchange: string,
): Promise<void> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  const redis = getRedis();
  await redis.sadd(symbolTriggerUsersKey(normalized), userId);

  const coverage = await getTriggerCoverage();
  const exchangeLabel = exchange.trim().toUpperCase() || "NASDAQ";
  if (!coverage.some((e) => e.symbol === normalized)) {
    await saveTriggerCoverage([
      ...coverage,
      {
        symbol: normalized,
        exchange: exchangeLabel,
        addedAt: new Date().toISOString(),
      },
    ]);
  }

  // Ensure cron scans this symbol even if it's not on anyone's watchlist yet.
  const system = await getSystemWatchlist();
  if (!system.some((e) => e.symbol === normalized)) {
    await writeWatchlist(SYSTEM_WATCHLIST_KEY, [
      ...system,
      {
        symbol: normalized,
        exchange: exchangeLabel,
        addedAt: new Date().toISOString(),
      },
    ]);
  }
}

export async function removeSymbolTriggerUserIfIdle(params: {
  symbol: string;
  userId: string;
  stillActive: boolean;
}): Promise<void> {
  const normalized = normalizeSymbol(params.symbol);
  if (!normalized) return;
  const redis = getRedis();

  if (params.stillActive) {
    await redis.sadd(symbolTriggerUsersKey(normalized), params.userId);
    return;
  }

  await redis.srem(symbolTriggerUsersKey(normalized), params.userId);
  const remaining = await redis.smembers(symbolTriggerUsersKey(normalized));
  if (remaining.length === 0) {
    const coverage = await getTriggerCoverage();
    await saveTriggerCoverage(
      coverage.filter((e) => e.symbol !== normalized),
    );
  }
}

export async function getSymbolTriggerUsers(
  symbol: string,
): Promise<string[]> {
  const members = await getRedis().smembers(
    symbolTriggerUsersKey(normalizeSymbol(symbol)),
  );
  return members.filter((id) => typeof id === "string" && id.trim());
}

export async function wasTriggerFiredRecently(
  userId: string,
  triggerId: string,
): Promise<boolean> {
  const existing = await getRedis().get<string>(
    triggerFireKey(userId, triggerId),
  );
  return existing !== null && existing !== undefined;
}

export async function markTriggerFired(
  userId: string,
  triggerId: string,
): Promise<void> {
  await getRedis().set(
    triggerFireKey(userId, triggerId),
    new Date().toISOString(),
    { ex: ALERT_TTL_SECONDS },
  );
}

export {
  ALERT_TTL_SECONDS,
  DEFAULT_PAPER_CASH,
  SYSTEM_WATCHLIST_KEY,
  rebuildSystemWatchlist,
};
