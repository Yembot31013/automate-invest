import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const FINNHUB_RPM = Number(process.env.FINNHUB_RPM ?? 55);
const RATE_KEY = "ratelimit:finnhub:minute";

/**
 * Sliding 60s window counter for Finnhub free-tier protection.
 * Throws if the budget is exhausted.
 */
export async function acquireFinnhubSlot(): Promise<void> {
  const redis = getRedis();
  const count = await redis.incr(RATE_KEY);
  if (count === 1) {
    await redis.expire(RATE_KEY, 60);
  }
  if (count > FINNHUB_RPM) {
    logger.warn("ratelimit", "Finnhub RPM exceeded", { count, FINNHUB_RPM });
    throw new Error(
      `Finnhub rate limit reached (${FINNHUB_RPM}/min). Try again shortly.`,
    );
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await getRedis().get<T>(key);
  return value ?? null;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await getRedis().set(key, value, { ex: ttlSeconds });
}
