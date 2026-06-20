import { describe, expect, it, vi } from "vitest";
import { BabyClient } from "../src/client.js";
import {
  getSleepRecommendation,
  groupSleepRecommendations,
  listGroupedSleepRecommendations,
  listSleepRecommendations,
} from "../src/sleep-recommendations.js";

describe("Baby Daybook sleep recommendations", () => {
  it("uses the recovered newborn recommendation constants", () => {
    expect(getSleepRecommendation(0)).toEqual({
      ageMonths: 0,
      wakeWindow: { minimumMinutes: 35, maximumMinutes: 60 },
      nap: { minimumMinutes: 20, maximumMinutes: 120 },
      totalNap: { minimumMinutes: 240, maximumMinutes: 300 },
      nightSleep: { minimumMinutes: 600, maximumMinutes: 750 },
      totalSleep: { minimumMinutes: 840, maximumMinutes: 1020 },
      napCount: { minimum: 5, maximum: 8 },
    });
    expect(getSleepRecommendation(1).wakeWindow).toEqual({ minimumMinutes: 50, maximumMinutes: 80 });
  });

  it("aggregates every available schedule for an age", () => {
    expect(getSleepRecommendation(2)).toEqual({
      ageMonths: 2,
      wakeWindow: { minimumMinutes: 45, maximumMinutes: 105 },
      nap: { minimumMinutes: 20, maximumMinutes: 120 },
      totalNap: { minimumMinutes: 270, maximumMinutes: 330 },
      nightSleep: { minimumMinutes: 600, maximumMinutes: 720 },
      totalSleep: { minimumMinutes: 840, maximumMinutes: 1020 },
      napCount: { minimum: 4, maximum: 6 },
    });
  });

  it("ignores zero duration constraints while retaining zero naps", () => {
    expect(getSleepRecommendation(48)).toEqual({
      ageMonths: 48,
      wakeWindow: { minimumMinutes: 300, maximumMinutes: 420 },
      nap: { minimumMinutes: 60, maximumMinutes: 120 },
      totalNap: { minimumMinutes: 60, maximumMinutes: 120 },
      nightSleep: { minimumMinutes: 600, maximumMinutes: 780 },
      totalSleep: { minimumMinutes: 600, maximumMinutes: 780 },
      napCount: { minimum: 0, maximum: 1 },
    });
  });

  it("groups identical consecutive age recommendations", () => {
    const grouped = listGroupedSleepRecommendations(24, 35);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.agesMonths).toEqual([24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]);

    const custom = listSleepRecommendations(0, 2);
    expect(groupSleepRecommendations([custom[2]!, custom[0]!, custom[1]!]).map((item) => item.agesMonths)).toEqual([[0], [1], [2]]);
  });

  it("validates the app's supported recommendation ages", () => {
    expect(listSleepRecommendations(12, 12)).toHaveLength(1);
    expect(() => getSleepRecommendation(-1)).toThrow(RangeError);
    expect(() => getSleepRecommendation(60)).toThrow(RangeError);
    expect(() => getSleepRecommendation(Number.NaN)).toThrow(RangeError);
    expect(() => listSleepRecommendations(5, 4)).toThrow(RangeError);
  });

  it("uses corrected age through BabyClient", async () => {
    const client = Object.create(BabyClient.prototype) as BabyClient;
    Object.assign(client, {
      babyUid: "baby",
      get: vi.fn(async () => ({
        uid: "baby",
        userUid: "user",
        name: "Baby",
        birthdayMillis: new Date(2025, 10, 6).getTime(),
        expectedBirthdayMillis: new Date(2026, 0, 6).getTime(),
        isPremature: true,
      })),
    });

    await expect(client.getSleepRecommendation(new Date(2026, 6, 6))).resolves.toMatchObject({ ageMonths: 6 });
  });
});
