import { describe, expect, it } from "vitest";
import {
  babyAdjustedAgeMonths,
  getExpandedSleepSchedulesForAge,
  getSleepSchedulesForAge,
  listSampleSleepSchedules,
  materializeSleepSchedule,
  selectSleepSchedule,
  selectSleepScheduleForBaby,
} from "../src/index.js";

describe("sleep prediction reference schedules", () => {
  it("loads every schedule recovered from the app snapshot", () => {
    const schedules = listSampleSleepSchedules();
    expect(schedules).toHaveLength(42);
    expect(schedules.every((schedule) => schedule.naps.length === schedule.napCount)).toBe(true);
    expect(Object.isFrozen(schedules)).toBe(true);
    expect(Object.isFrozen(schedules[0]?.naps)).toBe(true);
  });

  it("matches exact decompiled nap, night, and constraint values", () => {
    const schedule = selectSleepSchedule({ ageMonths: 2, napCount: 6, expanded: false });
    expect(schedule.naps[0]).toEqual({ start: { hour: 7, minute: 5 }, end: { hour: 8, minute: 0 } });
    expect(schedule.nightSleep).toEqual({ start: { hour: 20, minute: 0 }, end: { hour: 6, minute: 0 } });
    expect(schedule.constraints).toMatchObject({
      wakeWindow: { minimumMinutes: 45, maximumMinutes: 105 },
      totalNap: { minimumMinutes: 270, maximumMinutes: 330 },
      totalSleep: { minimumMinutes: 840, maximumMinutes: 1020 },
    });
  });

  it("uses the app's age buckets after 24 months", () => {
    expect(getSleepSchedulesForAge(24).map((schedule) => schedule.ageMonths)).toEqual([24]);
    expect(getSleepSchedulesForAge(35).map((schedule) => schedule.ageMonths)).toEqual([24]);
    expect(getSleepSchedulesForAge(36).map((schedule) => schedule.ageMonths)).toEqual([36, 36]);
    expect(getSleepSchedulesForAge(47).map((schedule) => schedule.ageMonths)).toEqual([36, 36]);
    expect(getSleepSchedulesForAge(48).map((schedule) => schedule.ageMonths)).toEqual([48, 48]);
    expect(getSleepSchedulesForAge(59).map((schedule) => schedule.ageMonths)).toEqual([48, 48]);
  });

  it("expands nearby transition schedules and selects the nearest nap count", () => {
    expect(getExpandedSleepSchedulesForAge(12).map((schedule) => schedule.napCount)).toEqual([1, 2, 3]);
    expect(getExpandedSleepSchedulesForAge(13).map((schedule) => schedule.napCount)).toEqual([1, 2]);
    expect(selectSleepSchedule({ ageMonths: 12, napCount: 1 }).ageMonths).toBe(13);
    expect(selectSleepSchedule({ ageMonths: 36, napCount: 3 }).napCount).toBe(1);
    expect(selectSleepSchedule({ ageMonths: 2, napCount: 0, expanded: false }).napCount).toBe(4);
  });

  it("materializes night sleep across midnight", () => {
    const schedule = selectSleepSchedule({ ageMonths: 48, napCount: 0 });
    const dated = materializeSleepSchedule(schedule, new Date(2026, 6, 6, 14));
    const start = new Date(dated.nightSleep.startMillis);
    const end = new Date(dated.nightSleep.endMillis);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 6, 6, 19]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([2026, 6, 7, 7]);
  });

  it("rejects ages and nap counts outside the app contract", () => {
    expect(() => getSleepSchedulesForAge(1)).toThrow(RangeError);
    expect(() => getSleepSchedulesForAge(60)).toThrow(RangeError);
    expect(() => selectSleepSchedule({ ageMonths: 12, napCount: -1 })).toThrow(RangeError);
  });

  it("uses corrected age for premature babies", () => {
    const baby = {
      uid: "b",
      userUid: "u",
      name: "Baby",
      birthdayMillis: new Date(2025, 10, 6).getTime(),
      expectedBirthdayMillis: new Date(2026, 0, 6).getTime(),
      isPremature: true,
      sleepPredictionNapCount: 3,
    };
    const date = new Date(2026, 6, 6);
    expect(babyAdjustedAgeMonths(baby, date)).toBe(6);
    expect(selectSleepScheduleForBaby(baby, date)).toMatchObject({ ageMonths: 6, napCount: 3 });
    expect(babyAdjustedAgeMonths({ ...baby, isPremature: false }, date)).toBe(8);
  });
});
