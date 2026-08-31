import {
  getDeskSettingsRaw,
  saveDeskSettingsRaw,
} from "@/lib/redis";
import {
  DEFAULT_DESK_SETTINGS,
  normalizeDeskSettings,
  type DeskSettings,
} from "@/lib/desk-settings";

export async function getDeskSettings(userId: string): Promise<DeskSettings> {
  const raw = await getDeskSettingsRaw(userId);
  return normalizeDeskSettings(raw ?? undefined);
}

export async function saveDeskSettings(
  userId: string,
  settings: DeskSettings,
): Promise<DeskSettings> {
  const next = normalizeDeskSettings(settings);
  await saveDeskSettingsRaw(userId, next);
  return next;
}

export async function enableAutoTrade(
  userId: string,
  quizVersion: number,
): Promise<DeskSettings> {
  const current = await getDeskSettings(userId);
  return saveDeskSettings(userId, {
    ...current,
    autoTradeEnabled: true,
    autoTradeEnabledAt: new Date().toISOString(),
    autoTradeQuizVersion: quizVersion,
  });
}

export async function disableAutoTrade(userId: string): Promise<DeskSettings> {
  const current = await getDeskSettings(userId);
  return saveDeskSettings(userId, {
    ...current,
    autoTradeEnabled: false,
    autoTradeEnabledAt: null,
    autoTradeQuizVersion: null,
  });
}

export { DEFAULT_DESK_SETTINGS };
