import { describe, expect, it } from "vitest";
import {
  buildStatisticsActivityCountBins,
  buildStatisticsActivityCountSummary,
  buildStatisticsAmountBins,
  buildStatisticsAmountSummary,
  buildStatisticsVolumeBins,
  buildStatisticsVolumeSummary,
  buildStatisticsDateRangeNavigation,
  canShowStatisticsComparison,
  canLoadNextStatisticsDateRange,
  canLoadPreviousStatisticsDateRange,
  getNextStatisticsDateRange,
  getPreviousStatisticsDateRange,
  getStatisticsChangePercent,
  getStatisticsChartPeriod,
  getStatisticsChartPeriodStarts,
  getStatisticsComparisonDateRange,
  getStatisticsPredefinedDateRange,
  getStatisticsQueryDateRange,
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

  it("selects native chart periods at the exact day thresholds", () => {
    expect(getStatisticsChartPeriod(dateRange([2026, 0, 1], [2026, 1, 1]))).toBe("day");
    expect(getStatisticsChartPeriod(dateRange([2026, 0, 1], [2026, 1, 2]))).toBe("month");
    expect(getStatisticsChartPeriod(dateRange([2024, 0, 1], [2025, 0, 1]))).toBe("month");
    expect(getStatisticsChartPeriod(dateRange([2024, 0, 1], [2025, 0, 2]))).toBe("year");
  });

  it("builds the adjacent comparison and expanded query ranges", () => {
    const current = dateRange([2026, 2, 9], [2026, 2, 15]);
    const comparison = getStatisticsComparisonDateRange(current);
    expectDates(comparison, [2026, 2, 2], [2026, 2, 8]);
    expectDates(getStatisticsQueryDateRange(current, true), [2026, 2, 2], [2026, 2, 15]);
    expect(getStatisticsQueryDateRange(current, false)).toEqual(current);

    const year = dateRange([2024, 0, 1], [2025, 0, 2]);
    expect(canShowStatisticsComparison(year)).toBe(false);
    expect(getStatisticsQueryDateRange(year, true)).toEqual(year);
  });

  it("matches the native asymmetric comparison percentage", () => {
    expect(getStatisticsChangePercent(15, 10)).toBe(50);
    expect(getStatisticsChangePercent(10, 15)).toBe(-50);
    expect(getStatisticsChangePercent(10, 10)).toBe(0);
    expect(getStatisticsChangePercent(0, 10)).toBe(0);
    expect(() => getStatisticsChangePercent(Number.NaN, 10)).toThrow("must be finite");
  });

  it("creates native empty chart bins from the containing period start", () => {
    const days = dateRange([2026, 2, 7], [2026, 2, 10]);
    expect(getStatisticsChartPeriodStarts(days).map(parts).map((value) => value.slice(0, 3))).toEqual([
      [2026, 2, 7], [2026, 2, 8], [2026, 2, 9], [2026, 2, 10],
    ]);

    const months = dateRange([2026, 0, 15], [2026, 3, 2]);
    expect(getStatisticsChartPeriodStarts(months).map(parts).map((value) => value.slice(0, 3))).toEqual([
      [2026, 0, 1], [2026, 1, 1], [2026, 2, 1], [2026, 3, 1],
    ]);

    const years = dateRange([2024, 5, 1], [2026, 0, 2]);
    expect(getStatisticsChartPeriodStarts(years).map(parts).map((value) => value.slice(0, 3))).toEqual([
      [2024, 0, 1], [2025, 0, 1], [2026, 0, 1],
    ]);
  });

  it("aggregates active activity starts into native period bins", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 10]);
    const bins = buildStatisticsActivityCountBins([
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 18).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "sleeping" },
      { startMillis: new Date(2026, 2, 9, 9).getTime(), type: "bottle", deleted: true },
      { startMillis: new Date(2026, 2, 11, 9).getTime(), type: "bottle" },
    ], range, "bottle");
    expect(bins.map((bin) => bin.activityCount)).toEqual([2, 0, 0, 0]);
  });

  it("builds native count cards with per-day and five-minute interval rules", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const summary = buildStatisticsActivityCountSummary([
      { startMillis: new Date(2026, 2, 7, 8).getTime(), endMillis: new Date(2026, 2, 7, 8, 30).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 8, 4).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 11).getTime(), type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 12).getTime(), type: "bottle", deleted: true },
    ], range, { typeUid: "bottle" });

    expect(summary).toEqual({
      total: { value: 4 },
      averagePerDay: { value: 2 },
      averageTimeBetweenMillis: { value: 116 * 60 * 1_000 },
    });
  });

  it("can calculate time since the previous end and compare adjacent cards", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const summary = buildStatisticsActivityCountSummary([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 6, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), endMillis: new Date(2026, 2, 7, 9).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 10).getTime(), type: "bottle" },
    ], range, { typeUid: "bottle", comparisonRange, timeBetweenFromEnd: true });

    expect(summary.total).toEqual({ value: 4, comparisonValue: 2, changePercent: 100 });
    expect(summary.averagePerDay).toEqual({ value: 2, comparisonValue: 1, changePercent: 100 });
    expect(summary.averageTimeBetweenMillis).toEqual({ value: 90 * 60 * 1_000, comparisonValue: 0, changePercent: 0 });
  });

  it("builds native volume bins and total, per-day, and per-activity cards", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const activities = [
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "bottle", volume: 90 },
      { startMillis: new Date(2026, 2, 7, 12).getTime(), type: "bottle", volume: 120 },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 10).getTime(), type: "drink", volume: 50 },
      { startMillis: new Date(2026, 2, 8, 12).getTime(), type: "bottle", volume: 500, deleted: true },
    ];

    expect(buildStatisticsVolumeBins(activities, range, "bottle").map(({ volume, activityCount }) => ({ volume, activityCount }))).toEqual([
      { volume: 210, activityCount: 2 },
      { volume: 0, activityCount: 1 },
    ]);
    expect(buildStatisticsVolumeSummary(activities, range, { typeUid: "bottle" })).toEqual({
      total: { value: 210 },
      averagePerDay: { value: 105 },
      averagePerActivity: { value: 70 },
    });
  });

  it("compares native volume cards and rejects malformed selected values", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const activities = [
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "bottle", volume: 100 },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "bottle", volume: 100 },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "bottle", volume: 100 },
      { startMillis: Number.NaN, type: "drink", volume: Number.NaN },
    ];
    const summary = buildStatisticsVolumeSummary(activities, range, { typeUid: "bottle", comparisonRange });

    expect(summary.total).toEqual({ value: 200, comparisonValue: 100, changePercent: 100 });
    expect(summary.averagePerDay).toEqual({ value: 100, comparisonValue: 50, changePercent: 100 });
    expect(summary.averagePerActivity).toEqual({ value: 100, comparisonValue: 100, changePercent: 0 });
    expect(() => buildStatisticsVolumeSummary([
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "bottle", volume: Number.NaN },
    ], range, { typeUid: "bottle" })).toThrow("Activity volume must be finite");
  });

  it("keeps native amount charts and cards separated by unit", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const activities = [
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", amount: 2, amountUnit: "oz" },
      { startMillis: new Date(2026, 2, 7, 12).getTime(), type: "food", amount: 3, amountUnit: "oz" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "food", amount: 100, amountUnit: "g" },
      { startMillis: new Date(2026, 2, 8, 10).getTime(), type: "medicine", amount: 5, amountUnit: "oz" },
      { startMillis: new Date(2026, 2, 8, 12).getTime(), type: "food", amountUnit: "oz" },
    ];

    expect(buildStatisticsAmountBins(activities, range, "oz", "food").map(({ amount, activityCount }) => ({ amount, activityCount }))).toEqual([
      { amount: 5, activityCount: 2 },
      { amount: 0, activityCount: 1 },
    ]);
    expect(buildStatisticsAmountSummary(activities, range, { amountUnit: "oz", typeUid: "food" })).toEqual({
      total: { value: 5 },
      averagePerDay: { value: 2.5 },
      averagePerActivity: { value: 5 / 3 },
    });
  });

  it("compares amount-unit cards and validates the selected unit", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const summary = buildStatisticsAmountSummary([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "food", amount: 2, amountUnit: "serving" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", amount: 2, amountUnit: "serving" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "food", amount: 2, amountUnit: "serving" },
    ], range, { amountUnit: "serving", typeUid: "food", comparisonRange });

    expect(summary.total).toEqual({ value: 4, comparisonValue: 2, changePercent: 100 });
    expect(summary.averagePerDay).toEqual({ value: 2, comparisonValue: 1, changePercent: 100 });
    expect(summary.averagePerActivity).toEqual({ value: 2, comparisonValue: 2, changePercent: 0 });
    expect(() => buildStatisticsAmountBins([], range, "  ")).toThrow("Amount unit must not be empty");
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
