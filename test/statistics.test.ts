import { describe, expect, it } from "vitest";
import { buildActivityStatistics } from "../src/index.js";
import type { DailyAction } from "../src/index.js";

const day = new Date(2026, 6, 6);
const at = (dateOffset: number, hour: number, minute = 0) => new Date(2026, 6, 6 + dateOffset, hour, minute).getTime();

const activities: DailyAction[] = [
  activity({ uid: "b1", type: "bottle", startMillis: at(0, 8), amount: 4, amountUnit: "oz", volume: 120, groupUid: "milk", reaction: "liked" }),
  activity({ uid: "b2", type: "bottle", startMillis: at(0, 9), amount: 5, amountUnit: "oz", volume: 150, groupUid: "milk", reaction: "liked", temperature: 37.2 }),
  activity({ uid: "nap", type: "sleeping", startMillis: at(0, 13), endMillis: at(0, 14, 30) }),
  activity({ uid: "night", type: "sleeping", startMillis: at(0, 20), endMillis: at(1, 6) }),
  activity({ uid: "deleted", type: "bottle", startMillis: at(0, 10), amount: 99, amountUnit: "oz", deleted: true }),
];

describe("activity statistics", () => {
  it("builds all chart dimensions from activity records", () => {
    const report = buildActivityStatistics(activities);
    expect(report).toMatchObject({ count: 4, amount: 9, volume: 270 });
    expect(report.byType.bottle).toMatchObject({ count: 2, amount: 9, volume: 270 });
    expect(report.byGroup.milk).toMatchObject({ count: 2, amount: 9 });
    expect(report.byAmountUnit.oz).toEqual({ count: 2, sum: 9, average: 4.5, minimum: 4, maximum: 5 });
    expect(report.byReaction).toEqual({ liked: 2 });
    expect(report.byHour[8]).toBe(1);
    expect(report.byHour[20]).toBe(1);
    expect(report.temperatures).toEqual({ count: 1, sum: 37.2, average: 37.2, minimum: 37.2, maximum: 37.2 });
  });

  it("separates daytime sleep, night sleep, naps, and awake time", () => {
    const report = buildActivityStatistics(activities);
    expect(report.sleep).toEqual({
      count: 2,
      durationMillis: 11.5 * 60 * 60_000,
      daytimeDurationMillis: 1.5 * 60 * 60_000,
      nightDurationMillis: 10 * 60 * 60_000,
      napCount: 1,
    });
    expect(report.days[0]).toMatchObject({
      date: "2026-07-06",
      daytimeSleepMillis: 1.5 * 60 * 60_000,
      nightSleepMillis: 10 * 60 * 60_000,
      awakeMillis: 10.5 * 60 * 60_000,
    });
  });

  it("filters by date and supports a custom daytime range", () => {
    const filtered = buildActivityStatistics(activities, { fromMillis: at(0, 12), toMillis: at(0, 19) });
    expect(filtered.count).toBe(1);
    expect(filtered.sleep.napCount).toBe(1);
    const custom = buildActivityStatistics(activities, { daytimeStartMinutes: 12 * 60, daytimeEndMinutes: 15 * 60 });
    expect(custom.sleep.daytimeDurationMillis).toBe(1.5 * 60 * 60_000);
    expect(custom.days[0]?.awakeMillis).toBe(1.5 * 60 * 60_000);
  });

  it("rejects invalid daytime ranges", () => {
    expect(() => buildActivityStatistics([], { daytimeStartMinutes: 18 * 60, daytimeEndMinutes: 6 * 60 })).toThrow(RangeError);
  });
});

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "u", babyUid: "b", type: "other", startMillis: day.getTime(), ...update };
}
