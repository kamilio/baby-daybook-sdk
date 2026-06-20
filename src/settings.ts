import type {
  BabySetting,
  BabySettingType,
  DaTypesConfigParams,
  NotificationsEnabledParams,
  QuickAddNotificationParams,
  SleepPredictionNotificationsParams,
  StickyNotificationParams,
} from "./types.js";

export const BABY_SETTING_TYPES = {
  quickAddNotification: "STICKY_SINGLE_ACTION_NOTIFICATION",
  stickyNotification: "STICKY_NOTIFICATION",
  notificationsEnabled: "NOTIFICATIONS_ENABLED",
  sleepPredictionNotifications: "SLEEP_PREDICTION_NOTIFICATIONS",
  daTypesConfig: "DA_TYPES_CONFIG",
} as const satisfies Record<string, BabySettingType>;

export const DEFAULT_BABY_SETTINGS = {
  notificationsEnabled: true,
  quickAddNotificationEnabled: false,
  sleepPredictionNotificationMinutes: 15,
  daTypesConfig: [] as readonly string[],
} as const;

export function parseNotificationsEnabled(setting: BabySetting | undefined): boolean {
  const enabled = parseParams<NotificationsEnabledParams>(setting)?.enabled;
  return typeof enabled === "boolean" ? enabled : DEFAULT_BABY_SETTINGS.notificationsEnabled;
}

export function parseQuickAddNotificationEnabled(setting: BabySetting | undefined): boolean {
  const enabled = parseParams<QuickAddNotificationParams>(setting)?.enabled;
  return typeof enabled === "boolean" ? enabled : DEFAULT_BABY_SETTINGS.quickAddNotificationEnabled;
}

export function parseStickyNotification(setting: BabySetting | undefined): StickyNotificationParams | undefined {
  const params = parseParams<StickyNotificationParams>(setting);
  if (!params || typeof params.daType !== "string" || typeof params.enabled !== "boolean") return undefined;
  return params;
}

export function parseSleepPredictionNotificationMinutes(setting: BabySetting | undefined): number {
  const value = parseParams<SleepPredictionNotificationsParams>(setting)?.minutesBeforeSleep;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_BABY_SETTINGS.sleepPredictionNotificationMinutes;
}

export function parseDaTypesConfig(setting: BabySetting | undefined): string[] {
  const value = parseParams<DaTypesConfigParams>(setting)?.daTypesConfig;
  if (typeof value !== "string") return [...DEFAULT_BABY_SETTINGS.daTypesConfig];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function serializeSettingParams(params: object): string {
  return JSON.stringify(params);
}

export function serializeDaTypesConfig(daTypes: readonly string[]): DaTypesConfigParams {
  return { daTypesConfig: daTypes.map((item) => item.trim()).filter(Boolean).join(",") };
}

function parseParams<T>(setting: BabySetting | undefined): T | undefined {
  if (!setting?.params) return undefined;
  try {
    const value = JSON.parse(setting.params) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
  } catch {
    return undefined;
  }
}
