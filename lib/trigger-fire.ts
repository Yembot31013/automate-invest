import { getClerkUserEmail } from "@/lib/clerk-user";
import { appendDeskEvent } from "@/lib/desk-events";
import { sendAttentionEmail } from "@/lib/email/attention";
import { logger } from "@/lib/logger";
import { getPortfolioSummary, paperBuy, paperSellMany } from "@/lib/paper";
import {
  getSymbolTriggerUsers,
  markTriggerFired,
  wasTriggerFiredRecently,
} from "@/lib/redis";
import {
  listEnabledTriggersForSymbol,
  touchTriggerFired,
} from "@/lib/triggers-store";
import {
  formatTriggerCondition,
  formatTriggerSummary,
  triggerConditionMet,
  type DeskTrigger,
} from "@/lib/triggers";
import type { AlertPayload, MarketSnapshot } from "@/types";

function snapshotAsAlert(
  snapshot: MarketSnapshot,
  trigger: DeskTrigger,
): AlertPayload {
  const cond = formatTriggerCondition(trigger.condition);
  return {
    type: "dip",
    snapshot,
    title: `Trigger · ${trigger.symbol}`,
    description: `Your rule hit: ${cond}. Action: ${trigger.action}. Mark ~$${snapshot.currentPrice.toFixed(2)} (${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(2)}% day).`,
  };
}

async function notifyTriggerAttention(params: {
  userId: string;
  trigger: DeskTrigger;
  snapshot: MarketSnapshot;
  extra?: string;
}): Promise<void> {
  const { userId, trigger, snapshot, extra } = params;
  const alert = snapshotAsAlert(snapshot, trigger);
  const email = await getClerkUserEmail(userId);
  const points = [
    formatTriggerSummary(trigger),
    `${snapshot.symbol} · mark ~$${snapshot.currentPrice.toFixed(2)} (${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(2)}%)`,
    ...(extra ? [extra] : []),
    "Open the desk to act — or tweak the trigger in the sidebar.",
  ];

  if (email) {
    const sent = await sendAttentionEmail({
      to: email,
      alert,
      reactionLine: `Trigger fired on ${trigger.symbol}`,
      points,
    });
    if (!sent.ok) {
      logger.error("triggers", "attention email failed", {
        userId,
        error: sent.error,
      });
    }
  }

  await appendDeskEvent(userId, {
    kind: "trigger-attention",
    text: `Trigger: ${formatTriggerSummary(trigger)} · day ${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(1)}%`,
    symbol: trigger.symbol,
  });
}

async function fireTriggerAction(params: {
  userId: string;
  trigger: DeskTrigger;
  snapshot: MarketSnapshot;
}): Promise<void> {
  const { userId, trigger, snapshot } = params;

  if (trigger.action === "attention") {
    await notifyTriggerAttention({ userId, trigger, snapshot });
    return;
  }

  if (trigger.action === "paper_buy") {
    try {
      const qty = Math.max(
        0.0001,
        Number((trigger.notionalUsd / snapshot.currentPrice).toFixed(4)),
      );
      const bought = await paperBuy({
        userId,
        symbol: trigger.symbol,
        exchange: trigger.exchange,
        quantity: qty,
        entryPrice: snapshot.currentPrice,
        notes: `trigger:${trigger.id}`,
      });
      await appendDeskEvent(userId, {
        kind: "trigger-buy",
        text: `Trigger buy: ${trigger.symbol} × ${qty} @ ~$${snapshot.currentPrice.toFixed(2)} (${formatTriggerCondition(trigger.condition)})`,
        symbol: trigger.symbol,
      });
      await notifyTriggerAttention({
        userId,
        trigger,
        snapshot,
        extra: `Paper bought ${qty} · cash left ~$${bought.cashRemaining.toFixed(0)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Buy failed";
      await appendDeskEvent(userId, {
        kind: "trigger-skip",
        text: `Trigger buy skipped (${trigger.symbol}): ${message}`,
        symbol: trigger.symbol,
      });
      await notifyTriggerAttention({
        userId,
        trigger,
        snapshot,
        extra: `Wanted a paper buy but couldn't: ${message}`,
      });
    }
    return;
  }

  // paper_sell
  try {
    const portfolio = await getPortfolioSummary(userId);
    const owned = portfolio.positions.some(
      (p) =>
        p.symbol === trigger.symbol ||
        p.symbol.replaceAll("/", "") === trigger.symbol.replaceAll("/", ""),
    );
    if (!owned) {
      await appendDeskEvent(userId, {
        kind: "trigger-skip",
        text: `Trigger sell skipped (${trigger.symbol}): no open lot`,
        symbol: trigger.symbol,
      });
      await notifyTriggerAttention({
        userId,
        trigger,
        snapshot,
        extra: "Rule wanted a sell, but you don’t hold that name.",
      });
      return;
    }
    const sold = await paperSellMany({
      userId,
      symbols: [trigger.symbol],
    });
    await appendDeskEvent(userId, {
      kind: "trigger-sell",
      text: `Trigger sell: ${trigger.symbol} · closed ${sold.closedCount} lot(s) (${formatTriggerCondition(trigger.condition)})`,
      symbol: trigger.symbol,
    });
    await notifyTriggerAttention({
      userId,
      trigger,
      snapshot,
      extra: `Paper sold ${sold.closedCount} lot(s) · cash ~$${sold.cashRemaining.toFixed(0)}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sell failed";
    await appendDeskEvent(userId, {
      kind: "trigger-skip",
      text: `Trigger sell skipped (${trigger.symbol}): ${message}`,
      symbol: trigger.symbol,
    });
    await notifyTriggerAttention({
      userId,
      trigger,
      snapshot,
      extra: `Wanted a paper sell but couldn't: ${message}`,
    });
  }
}

/**
 * After a symbol snapshot is built (cron or on-demand scan), fire matching user triggers.
 */
export async function runTriggersAgainstSnapshot(params: {
  snapshot: MarketSnapshot;
  /** When set, only evaluate this user's triggers (manual scan). */
  userId?: string;
  notify?: boolean;
}): Promise<string[]> {
  const { snapshot, userId, notify = true } = params;
  if (!notify) return [];

  const userIds = userId
    ? [userId]
    : await getSymbolTriggerUsers(snapshot.symbol);

  const fired: string[] = [];

  for (const uid of userIds) {
    const triggers = await listEnabledTriggersForSymbol(uid, snapshot.symbol);
    for (const trigger of triggers) {
      if (!triggerConditionMet(trigger.condition, snapshot)) continue;
      if (await wasTriggerFiredRecently(uid, trigger.id)) {
        fired.push(`${uid}:${trigger.id}:suppressed`);
        continue;
      }
      try {
        await fireTriggerAction({ userId: uid, trigger, snapshot });
        await markTriggerFired(uid, trigger.id);
        await touchTriggerFired(uid, trigger.id);
        fired.push(`${uid}:${trigger.id}`);
      } catch (err) {
        logger.error("triggers", "fire failed", {
          userId: uid,
          triggerId: trigger.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return fired;
}
