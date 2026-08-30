/**
 * Cost / rate-limit guards for Signal Desk.
 * Keep desk snapshots ≤ Finnhub-friendly concurrency; cap stored list separately.
 */

/** Max symbols a user may keep on their watchlist. */
export const MAX_USER_WATCHLIST = 20;

/** How many watchlist symbols get full tape snapshots per desk refresh. */
export const DESK_SNAPSHOT_LIMIT = 12;
