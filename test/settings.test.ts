import { describe, expect, it, vi } from "vitest";
import { AuthSession } from "../src/auth.js";
import { BabyClient, BabyDaybookClient } from "../src/client.js";
import {
  BABY_SETTING_TYPES,
  parseDaTypesConfig,
  parseNotificationsEnabled,
  parseSleepPredictionNotificationMinutes,
  parseStickyNotification,
} from "../src/settings.js";
import type { BabySetting } from "../src/types.js";
import { mockFetch } from "./helpers.js";

describe("Baby Daybook settings", () => {
  it("uses native defaults and safely ignores malformed params", () => {
    expect(parseNotificationsEnabled(undefined)).toBe(true);
    expect(parseNotificationsEnabled(setting(BABY_SETTING_TYPES.notificationsEnabled, "bad json"))).toBe(true);
    expect(parseNotificationsEnabled(setting(BABY_SETTING_TYPES.notificationsEnabled, "{\"enabled\":\"yes\"}"))).toBe(true);
    expect(parseSleepPredictionNotificationMinutes(undefined)).toBe(15);
    expect(parseSleepPredictionNotificationMinutes(setting(BABY_SETTING_TYPES.sleepPredictionNotifications, "{\"minutesBeforeSleep\":-1}"))).toBe(15);
    expect(parseDaTypesConfig(setting(BABY_SETTING_TYPES.daTypesConfig, "{\"daTypesConfig\":\" bottle, sleeping ,, \"}"))).toEqual(["bottle", "sleeping"]);
    expect(parseStickyNotification(setting(BABY_SETTING_TYPES.stickyNotification, "{\"daType\":\"bottle\",\"enabled\":true}"))).toEqual({ daType: "bottle", enabled: true });
  });

  it("persists singleton and per-activity settings with app-compatible records", async () => {
    const baby = configuredBaby([
      setting(BABY_SETTING_TYPES.notificationsEnabled, "{\"enabled\":false}", "notifications"),
      setting(BABY_SETTING_TYPES.stickyNotification, "{\"daType\":\"bottle\",\"enabled\":false}", "sticky-bottle"),
      setting(BABY_SETTING_TYPES.stickyNotification, "{\"daType\":\"sleeping\",\"enabled\":true}", "sticky-sleep"),
    ]);

    await expect(baby.areNotificationsEnabled()).resolves.toBe(false);
    await expect(baby.isStickyNotificationEnabled("sleeping")).resolves.toBe(true);
    await expect(baby.listStickyNotifications()).resolves.toEqual([
      { uid: "sticky-bottle", daType: "bottle", enabled: false },
      { uid: "sticky-sleep", daType: "sleeping", enabled: true },
    ]);

    await expect(baby.setNotificationsEnabled(true)).resolves.toMatchObject({
      uid: "notifications",
      babyUid: "baby",
      settingType: "NOTIFICATIONS_ENABLED",
      params: "{\"enabled\":true}",
    });
    await expect(baby.setStickyNotificationEnabled("bottle", true)).resolves.toMatchObject({
      uid: "sticky-bottle",
      params: "{\"daType\":\"bottle\",\"enabled\":true}",
    });
    await expect(baby.setDaTypesConfig([" bottle ", "sleeping", ""])).resolves.toMatchObject({
      settingType: "DA_TYPES_CONFIG",
      params: "{\"daTypesConfig\":\"bottle,sleeping\"}",
    });
  });

  it("validates setting inputs", async () => {
    const baby = configuredBaby([]);
    await expect(baby.setStickyNotificationEnabled(" ", true)).rejects.toThrow("must not be empty");
    expect(() => baby.setSleepPredictionNotificationMinutes(-1)).toThrow("non-negative integer");
  });
});

function configuredBaby(initial: BabySetting[]): BabyClient {
  const fetch = mockFetch();
  const client = new BabyDaybookClient({
    session: new AuthSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3_600_000 }, { fetch }),
    fetch,
  });
  const baby = new BabyClient(client, "baby");
  const repository = {
    items: [...initial],
    list: vi.fn(async () => [...repository.items]),
    save: vi.fn(async (item: BabySetting) => {
      repository.items = [...repository.items.filter((value) => value.uid !== item.uid), item];
      return item;
    }),
  };
  (baby as unknown as { settings: typeof repository }).settings = repository;
  return baby;
}

function setting(settingType: BabySetting["settingType"], params: string, uid: string = crypto.randomUUID()): BabySetting {
  return { uid, babyUid: "baby", settingType, params };
}
