import { MAX_USER_TRIGGERS } from "@/lib/limits";
import {
  addSymbolTriggerUser,
  getUserTriggersRaw,
  removeSymbolTriggerUserIfIdle,
  saveUserTriggersRaw,
  withUserTriggersLock,
} from "@/lib/redis";
import {
  buildDeskTrigger,
  normalizeTriggerList,
  TriggerLimitError,
  type DeskTrigger,
  type TriggerAction,
  type TriggerCondition,
} from "@/lib/triggers";

export async function listUserTriggers(userId: string): Promise<DeskTrigger[]> {
  const raw = await getUserTriggersRaw(userId);
  return normalizeTriggerList(raw);
}

async function persistAndSyncCoverage(
  userId: string,
  next: DeskTrigger[],
  touchedSymbols: Array<{ symbol: string; exchange: string }>,
): Promise<DeskTrigger[]> {
  await saveUserTriggersRaw(userId, next);
  for (const { symbol, exchange } of touchedSymbols) {
    const stillActive = next.some(
      (t) => t.enabled && t.symbol === symbol,
    );
    if (stillActive) {
      await addSymbolTriggerUser(symbol, userId, exchange);
    } else {
      await removeSymbolTriggerUserIfIdle({
        symbol,
        userId,
        stillActive: false,
      });
    }
  }
  return next;
}

export async function createUserTrigger(
  userId: string,
  input: {
    symbol: string;
    exchange?: string;
    condition: TriggerCondition;
    action: TriggerAction;
    notionalUsd?: number;
    autoPauseAfterFire?: boolean;
  },
): Promise<DeskTrigger> {
  return withUserTriggersLock(userId, async () => {
    const current = await listUserTriggers(userId);
    if (current.length >= MAX_USER_TRIGGERS) {
      throw new TriggerLimitError(current.length);
    }
    const trigger = buildDeskTrigger(input);
    const next = [...current, trigger];
    await persistAndSyncCoverage(userId, next, [
      { symbol: trigger.symbol, exchange: trigger.exchange },
    ]);
    return trigger;
  });
}

export type UserTriggerPatch = {
  enabled?: boolean;
  condition?: TriggerCondition;
  action?: TriggerAction;
  notionalUsd?: number;
  autoPauseAfterFire?: boolean;
};

export async function updateUserTrigger(
  userId: string,
  triggerId: string,
  patch: UserTriggerPatch,
): Promise<DeskTrigger | null> {
  return withUserTriggersLock(userId, async () => {
    const current = await listUserTriggers(userId);
    const idx = current.findIndex((t) => t.id === triggerId);
    if (idx < 0) return null;
    const prev = current[idx]!;
    const action = patch.action ?? prev.action;
    const updated: DeskTrigger = {
      ...prev,
      enabled: patch.enabled ?? prev.enabled,
      condition: patch.condition ?? prev.condition,
      action,
      notionalUsd:
        patch.notionalUsd !== undefined ? patch.notionalUsd : prev.notionalUsd,
      autoPauseAfterFire:
        patch.autoPauseAfterFire !== undefined
          ? patch.autoPauseAfterFire
          : prev.autoPauseAfterFire,
      updatedAt: new Date().toISOString(),
    };
    const next = current.map((t, i) => (i === idx ? updated : t));
    await persistAndSyncCoverage(userId, next, [
      { symbol: updated.symbol, exchange: updated.exchange },
    ]);
    return updated;
  });
}

export async function setUserTriggerEnabled(
  userId: string,
  triggerId: string,
  enabled: boolean,
): Promise<DeskTrigger | null> {
  return withUserTriggersLock(userId, async () => {
    const current = await listUserTriggers(userId);
    const idx = current.findIndex((t) => t.id === triggerId);
    if (idx < 0) return null;
    const prev = current[idx]!;
    const updated: DeskTrigger = {
      ...prev,
      enabled,
      updatedAt: new Date().toISOString(),
    };
    const next = current.map((t, i) => (i === idx ? updated : t));
    await persistAndSyncCoverage(userId, next, [
      { symbol: updated.symbol, exchange: updated.exchange },
    ]);
    return updated;
  });
}

export async function removeUserTrigger(
  userId: string,
  triggerId: string,
): Promise<{ removed: DeskTrigger | null; triggers: DeskTrigger[] }> {
  return withUserTriggersLock(userId, async () => {
    const current = await listUserTriggers(userId);
    const removed = current.find((t) => t.id === triggerId) ?? null;
    if (!removed) return { removed: null, triggers: current };
    const next = current.filter((t) => t.id !== triggerId);
    await persistAndSyncCoverage(userId, next, [
      { symbol: removed.symbol, exchange: removed.exchange },
    ]);
    return { removed, triggers: next };
  });
}

export async function touchTriggerFired(
  userId: string,
  triggerId: string,
): Promise<void> {
  await withUserTriggersLock(userId, async () => {
    const current = await listUserTriggers(userId);
    const next = current.map((t) =>
      t.id === triggerId
        ? {
            ...t,
            lastFiredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : t,
    );
    await saveUserTriggersRaw(userId, next);
  });
}

export async function listEnabledTriggersForSymbol(
  userId: string,
  symbol: string,
): Promise<DeskTrigger[]> {
  const want = symbol.trim().toUpperCase();
  const all = await listUserTriggers(userId);
  return all.filter((t) => t.enabled && t.symbol === want);
}
