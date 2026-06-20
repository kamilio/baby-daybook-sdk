import { describe, expect, it } from "vitest";
import {
  calculateGrowthPercentile,
  calculateGrowthValueAtPercentile,
  growthAgeAtDate,
  searchActivities,
  searchDailyNotes,
} from "../src/index.js";
import type { DailyAction, DailyNote } from "../src/index.js";

describe("growth percentiles", () => {
  it("matches the CDC median and inverse LMS calculation", () => {
    const median = calculateGrowthPercentile({
      source: "cdc_0_36_months",
      gender: "male",
      measurement: "weight",
      age: 0,
      value: 3.530203168,
    });
    expect(median).toMatchObject({ percentile: 50, rangeUnit: "months" });
    expect(median?.zScore).toBeCloseTo(0, 10);
    expect(median?.referenceValues[50]).toBeCloseTo(3.530203168, 8);
    expect(calculateGrowthValueAtPercentile({
      source: "cdc_0_36_months",
      gender: "male",
      measurement: "weight",
      age: 0,
      percentile: 50,
    })).toBeCloseTo(3.530203168, 8);
  });

  it("interpolates WHO data and supports week and year ranges", () => {
    const weekly = calculateGrowthPercentile({ source: "who_0_13_weeks", gender: "female", measurement: "height", age: 0.5, value: 49.73875 });
    expect(weekly).toMatchObject({ percentile: 50, rangeUnit: "weeks" });
    const yearly = calculateGrowthPercentile({ source: "cdcDS_2_20_years", gender: "male", measurement: "headSize", age: 2, value: 48.2 });
    expect(yearly?.rangeUnit).toBe("years");
  });

  it("rejects unsupported measurements, ages, and percentiles", () => {
    expect(calculateGrowthPercentile({ source: "cdc_2_20_years", gender: "male", measurement: "headSize", age: 24, value: 50 })).toBeUndefined();
    expect(calculateGrowthPercentile({ source: "who_0_13_weeks", gender: "male", measurement: "weight", age: 20, value: 5 })).toBeUndefined();
    expect(calculateGrowthValueAtPercentile({ source: "who_0_60_months", gender: "male", measurement: "weight", age: 1, percentile: 0 })).toBeUndefined();
  });

  it("returns boundary percentiles and converts date ages", () => {
    expect(calculateGrowthPercentile({ source: "cdc_0_36_months", gender: "male", measurement: "weight", age: 0, value: 0.5 })?.percentile).toBe(0);
    expect(calculateGrowthPercentile({ source: "cdc_0_36_months", gender: "male", measurement: "weight", age: 0, value: 20 })?.percentile).toBe(100);
    expect(growthAgeAtDate(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 15), "weeks")).toBe(2);
    expect(growthAgeAtDate(Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1), "years")).toBeCloseTo(1, 2);
  });
});

describe("search helpers", () => {
  const activities: DailyAction[] = [
    activity({ uid: "a", type: "bottle", startMillis: 100, notes: "Night feed", groupUid: "milk" }),
    activity({ uid: "b", type: "sleeping", startMillis: 200, notes: "Nap" }),
    activity({ uid: "c", type: "bottle", startMillis: 300, notes: "Deleted", deleted: true }),
  ];

  it("filters activities by text, type, group, date, and deletion state", () => {
    expect(searchActivities(activities, { query: "night" }).map((item) => item.uid)).toEqual(["a"]);
    expect(searchActivities(activities, { types: ["bottle"], groupUids: ["milk"] }).map((item) => item.uid)).toEqual(["a"]);
    expect(searchActivities(activities, { fromMillis: 150, toMillis: 250 }).map((item) => item.uid)).toEqual(["b"]);
    expect(searchActivities(activities, { includeDeleted: true }).map((item) => item.uid)).toEqual(["c", "b", "a"]);
  });

  it("searches daily notes case-insensitively", () => {
    const notes: DailyNote[] = [
      { uid: "a", userUid: "u", babyUid: "b", note: "Doctor appointment" },
      { uid: "b", userUid: "u", babyUid: "b", note: "Hidden", deleted: true },
    ];
    expect(searchDailyNotes(notes, "DOCTOR").map((note) => note.uid)).toEqual(["a"]);
    expect(searchDailyNotes(notes, "", { includeDeleted: true })).toHaveLength(2);
  });
});

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "u", babyUid: "b", type: "other", startMillis: 0, ...update };
}
