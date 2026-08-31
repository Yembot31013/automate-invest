import { logger } from "@/lib/logger";
import { getPaperCash, getPaperPositions } from "@/lib/redis";
import {
  listUserTriggers,
  setUserTriggerEnabled,
} from "@/lib/triggers-store";
import {
  normalizeOpenSymbols,
  triggersToAutoDisable,
  type TriggerBookContext,
} from "@/lib/trigger-validate";

export async function loadTriggerBookContext(
  userId: string,
): Promise<TriggerBookContext> {
  const [cash, positions] = await Promise.all([
    getPaperCash(userId),
    getPaperPositions(userId),
  ]);
  const open = positions.filter((p) => p.status === "open");
  return {
    cash,
    openSymbols: normalizeOpenSymbols(open),
  };
}

/**
 * After paper buys/sells: pause trade triggers that no longer fit the book
 * (no lot for paper_sell, or cash below paper_buy notional).
 */
export async function syncTriggersWithPaperBook(
  userId: string,
): Promise<string[]> {
  try {
    const [book, triggers] = await Promise.all([
      loadTriggerBookContext(userId),
      listUserTriggers(userId),
    ]);
    const disable = triggersToAutoDisable(triggers, book);
    const paused: string[] = [];
    for (const t of disable) {
      const updated = await setUserTriggerEnabled(userId, t.id, false);
      if (updated) paused.push(t.id);
    }
    if (paused.length > 0) {
      logger.info("triggers", "auto-paused after paper book change", {
        userId,
        paused,
      });
    }
    return paused;
  } catch (error) {
    logger.error("triggers", "sync with paper book failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
