import { describe, expect, it } from "vitest";
import {
  buildStatisticsDateRangeNavigation,
  canLoadNextStatisticsDateRange,
  canLoadPreviousStatisticsDateRange,
  getNextStatisticsDateRange,
  getPreviousStatisticsDateRange,
  getStatisticsPredefinedDateRange,
} from "../src/index.js";

describe("native statistics date ranges", () => {
  const now = new Date(2026, 6, 6, 13, 45).getTime();

  it("builds every predefined interval with inclusive local day boundaries", () => {
    const birthday = new Date(2026, 4, 20, 8).getTime();
    expectDates(getStatisticsPredefinedDateRange("last7Days", birthday, now), [2026, 5, 30], [2026, 6, 6]);
    expectDates(getStatisticsPredefinedDateRange("last14Days", birthday, now), [2026, 5, 23], [2026, 6, 6]);
    expectDates(getStatisticsPredefinedDateRange("last30Days", birthday, now), [2026, 5, 7], [2026, 6, 6]);
    expectDates(getStatisticsPredefinedDateRange("thisMonth", birthday, now), [2026, 6, 1], [2026, 6, 31]);
    expectDates(getStatisticsPredefinedDateRange("lastMonth", birthday, now), [2026, 5, 1], [2026, 5, 30]);
    expectDates(getStatisticsPredefinedDateRange("sinceBirthday", birthday, now), [2026, 4, 20], [2026, 6, 6]);
  });

  it("clamps a future birthday to today and requires it only for that preset", () => {
    const futureBirthday = new Date(2026, 7, 1).getTime();
    expectDates(getStatisticsPredefinedDateRange("sinceBirthday", futureBirthday, now), [2026, 6, 6], [2026, 6, 6]);
    expect(() => getStatisticsPredefinedDateRange("sinceBirthday", undefined, now)).toThrow("birthday is required");
    expect(() => getStatisticsPredefinedDateRange("last7Days", undefined, now)).not.toThrow();
  });

  it("pages fixed-day intervals without DST duration drift", () => {
    const range = dateRange([2026, 2, 2], [2026, 2, 8]);
    expectDates(getNextStatisticsDateRange(range), [2026, 2, 9], [2026, 2, 15]);
    expectDates(getPreviousStatisticsDateRange(range), [2026, 1, 23], [2026, 2, 1]);
  });

  it("pages full calendar months using each destination month length", () => {
    const march = dateRange([2024, 2, 1], [2024, 2, 31]);
    expectDates(getPreviousStatisticsDateRange(march), [2024, 1, 1], [2024, 1, 29]);
    expectDates(getNextStatisticsDateRange(march), [2024, 3, 1], [2024, 3, 30]);
  });

  it("uses the native today and birthday arrow guards", () => {
    const birthday = new Date(2026, 5, 1, 12).getTime();
    const current = dateRange([2026, 5, 30], [2026, 6, 6]);
    const past = dateRange([2026, 5, 22], [2026, 5, 29]);
    const birthdayDay = dateRange([2026, 5, 1], [2026, 5, 7]);

    expect(canLoadNextStatisticsDateRange(current, now)).toBe(false);
    expect(canLoadNextStatisticsDateRange(past, now)).toBe(true);
    expect(canLoadPreviousStatisticsDateRange(current, birthday)).toBe(true);
    expect(canLoadPreviousStatisticsDateRange(birthdayDay, birthday)).toBe(false);
    expect(buildStatisticsDateRangeNavigation(current, birthday, now)).toEqual({
      range: current,
      canLoadPrevious: true,
      canLoadNext: false,
    });
  });

  it("rejects invalid timestamps and reversed ranges", () => {
    expect(() => getNextStatisticsDateRange({ fromMillis: 2, toMillis: 1 })).toThrow("must not be after");
    expect(() => canLoadNextStatisticsDateRange({ fromMillis: 0, toMillis: Number.NaN }, now)).toThrow("must be finite");
    expect(() => getStatisticsPredefinedDateRange("last7Days", 0, Number.POSITIVE_INFINITY)).toThrow("must be finite");
  });
});

function dateRange(from: DateParts, to: DateParts) {
  return {
    fromMillis: new Date(from[0], from[1], from[2]).getTime(),
    toMillis: new Date(to[0], to[1], to[2] + 1).getTime() - 1,
  };
}

function expectDates(range: { fromMillis: number; toMillis: number }, from: DateParts, to: DateParts): void {
  expect(parts(range.fromMillis)).toEqual([...from, 0, 0, 0, 0]);
  expect(parts(range.toMillis)).toEqual([...to, 23, 59, 59, 999]);
}

function parts(millis: number): number[] {
  const date = new Date(millis);
  return [
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(),
  ];
}

type DateParts = readonly [year: number, monthIndex: number, day: number];
