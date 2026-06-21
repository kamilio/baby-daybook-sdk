import { describe, expect, it } from "vitest";
import {
  buildStatisticsActivityCountBins,
  buildStatisticsActivityCountSummary,
  buildStatisticsAmountBins,
  buildStatisticsAmountSummary,
  buildStatisticsDurationBins,
  buildStatisticsDurationSummary,
  buildStatisticsGroupBreakdown,
  buildStatisticsNapCountData,
  buildStatisticsSleepDurationData,
  buildStatisticsParameterBreakdown,
  buildStatisticsReactionDistribution,
  buildStatisticsTemperatureData,
  buildStatisticsTimeOfDayDistribution,
  buildStatisticsVolumeBins,
  buildStatisticsVolumeByHour,
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
  getStatisticsActivityParameters,
  matchesStatisticsActivityParameter,
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

  it("builds the native hourly average-volume card", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const bins = buildStatisticsVolumeByHour([
      { startMillis: new Date(2026, 2, 7, 8, 5).getTime(), type: "bottle", volume: 90 },
      { startMillis: new Date(2026, 2, 8, 8, 45).getTime(), type: "bottle", volume: 150 },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "drink", volume: 500 },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "bottle", volume: 500, deleted: true },
    ], range, { typeUid: "bottle" });

    expect(bins).toHaveLength(24);
    expect(bins[8]).toEqual({ hour: 8, totalVolume: 240, activityCount: 2, averageVolume: 120 });
    expect(bins[9]).toEqual({ hour: 9, totalVolume: 0, activityCount: 1, averageVolume: 0 });
    expect(bins[10]).toEqual({ hour: 10, totalVolume: 0, activityCount: 0, averageVolume: 0 });
  });

  it("adds native comparison values to hourly volume averages", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 5]);
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const bins = buildStatisticsVolumeByHour([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "bottle", volume: 100 },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "bottle", volume: 100 },
      { startMillis: new Date(2026, 2, 7, 8, 30).getTime(), type: "bottle", volume: 300 },
    ], range, { typeUid: "bottle", comparisonRange });

    expect(bins[8]).toEqual({
      hour: 8,
      totalVolume: 400,
      activityCount: 2,
      averageVolume: 200,
      comparisonTotalVolume: 100,
      comparisonActivityCount: 1,
      comparisonAverageVolume: 100,
      changePercent: 100,
    });
    expect(bins[9]?.changePercent).toBe(0);
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

  it("builds native duration period totals and the average-per-day card", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const activities = [
      { startMillis: new Date(2026, 2, 7, 8).getTime(), endMillis: new Date(2026, 2, 7, 9).getTime(), type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 12).getTime(), endMillis: new Date(2026, 2, 7, 14).getTime(), duration: 90 * 60_000, type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), duration: 30 * 60_000, type: "tummy_time" },
    ];

    expect(buildStatisticsDurationBins(activities, range, "sleeping").map(({ durationMillis, activityCount }) => ({ durationMillis, activityCount }))).toEqual([
      { durationMillis: 150 * 60_000, activityCount: 2 },
      { durationMillis: 0, activityCount: 1 },
    ]);
    expect(buildStatisticsDurationSummary(activities, range, { typeUid: "sleeping" })).toEqual({
      averagePerDayMillis: { value: 75 * 60_000 },
    });
  });

  it("compares duration averages and clamps invalid negative spans", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const summary = buildStatisticsDurationSummary([
      { startMillis: new Date(2026, 2, 5, 9).getTime(), duration: 60 * 60_000, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 9).getTime(), duration: 60 * 60_000, type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), endMillis: new Date(2026, 2, 8, 8).getTime(), type: "sleeping" },
    ], range, { typeUid: "sleeping", comparisonRange });

    expect(summary.averagePerDayMillis).toEqual({
      value: 30 * 60_000,
      comparisonValue: 30 * 60_000,
      changePercent: 0,
    });
  });

  it("builds native temperature scatter periods and selects the highest period average", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 9]);
    const data = buildStatisticsTemperatureData([
      { startMillis: new Date(2026, 2, 7, 18).getTime(), type: "temperature", temperature: 38 },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "temperature", temperature: 36 },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "temperature", temperature: 37.5 },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "temperature" },
      { startMillis: new Date(2026, 2, 8, 10).getTime(), type: "other", temperature: 50 },
      { startMillis: new Date(2026, 2, 9, 8).getTime(), type: "temperature", temperature: 40, deleted: true },
    ], range);

    expect(data.points.map((point) => point.temperature)).toEqual([36, 38, 37.5]);
    expect(data.periods.map(({ count, average, minimum, maximum }) => ({ count, average, minimum, maximum }))).toEqual([
      { count: 2, average: 37, minimum: 36, maximum: 38 },
      { count: 1, average: 37.5, minimum: 37.5, maximum: 37.5 },
    ]);
    expect(data.highestPeriodAverage).toBe(37.5);
  });

  it("keeps temperature data raw and validates selected readings", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    expect(buildStatisticsTemperatureData([], range)).toEqual({ points: [], periods: [], highestPeriodAverage: undefined });
    expect(() => buildStatisticsTemperatureData([
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "temperature", temperature: Number.NaN },
    ], range)).toThrow("Activity temperature must be finite");
  });

  it("builds the native three-category reaction distribution", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const distribution = buildStatisticsReactionDistribution([
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", reaction: "liked" },
      { startMillis: new Date(2026, 2, 7, 9).getTime(), type: "food", reaction: "liked" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "food", reaction: "neutral" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "food", reaction: "disliked" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "food", reaction: "future-value" },
      { startMillis: new Date(2026, 2, 8, 10).getTime(), type: "medicine", reaction: "liked" },
      { startMillis: new Date(2026, 2, 8, 11).getTime(), type: "food", reaction: "liked", deleted: true },
    ], range, { typeUid: "food" });

    expect(distribution).toEqual({
      counts: { liked: 2, neutral: 1, disliked: 1 },
      total: 4,
      liked: { value: 2 },
    });
  });

  it("matches the native liked-reaction comparison summary", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const distribution = buildStatisticsReactionDistribution([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "food", reaction: "liked" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", reaction: "liked" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "food", reaction: "liked" },
    ], range, { typeUid: "food", comparisonRange });

    expect(distribution.liked).toEqual({ value: 2, comparisonValue: 1, changePercent: 100 });
  });

  it("builds the native 24-hour time-of-day distribution", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const bins = buildStatisticsTimeOfDayDistribution([
      { startMillis: new Date(2026, 2, 7, 0, 30).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 8, 15).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 8, 45).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 23, 59).getTime(), type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 9).getTime(), type: "bottle", deleted: true },
    ], range, { typeUid: "bottle" });

    expect(bins).toHaveLength(24);
    expect(bins[0]).toEqual({ hour: 0, count: 1 });
    expect(bins[8]).toEqual({ hour: 8, count: 2 });
    expect(bins[23]).toEqual({ hour: 23, count: 0 });
  });

  it("adds the native comparison series to every time-of-day hour", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 6]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const bins = buildStatisticsTimeOfDayDistribution([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "bottle" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), type: "bottle" },
    ], range, { typeUid: "bottle", comparisonRange });

    expect(bins[8]).toEqual({ hour: 8, count: 2, comparisonCount: 1, changePercent: 100 });
    expect(bins[9]).toEqual({ hour: 9, count: 0, comparisonCount: 0, changePercent: 0 });
  });

  it("exposes the native parameter sets and matching rules", () => {
    expect(getStatisticsActivityParameters("breastfeeding")).toEqual(["left", "right"]);
    expect(getStatisticsActivityParameters("pump")).toEqual(["left", "right"]);
    expect(getStatisticsActivityParameters("potty")).toEqual(["pee", "poo", "peeAndPoo", "empty"]);
    expect(getStatisticsActivityParameters("diaper_change")).toEqual(["wet", "dirty", "wetAndDirty", "dry"]);
    expect(getStatisticsActivityParameters("bath")).toEqual(["hairWash", "noHairWash"]);
    expect(getStatisticsActivityParameters("food")).toEqual([]);

    expect(matchesStatisticsActivityParameter({ startMillis: 0, type: "potty", pee: true, poo: true }, "peeAndPoo")).toBe(true);
    expect(matchesStatisticsActivityParameter({ startMillis: 0, type: "diaper_change" }, "dry")).toBe(true);
    expect(matchesStatisticsActivityParameter({ startMillis: 0, type: "bath" }, "noHairWash")).toBe(true);
    expect(matchesStatisticsActivityParameter({ startMillis: 0, type: "pump", side: "both" }, "left")).toBe(true);
    expect(matchesStatisticsActivityParameter({ startMillis: 0, type: "pump", rightDuration: 1 }, "right")).toBe(true);
  });

  it("builds overlapping native potty and diaper parameter statistics", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const start = new Date(2026, 2, 7, 8).getTime();
    const potty = buildStatisticsParameterBreakdown([
      { startMillis: start, type: "potty", pee: true, duration: 10 },
      { startMillis: start + 60_000, type: "potty", poo: true, duration: 20 },
      { startMillis: start + 120_000, type: "potty", pee: true, poo: true, duration: 30 },
      { startMillis: start + 180_000, type: "potty", duration: 40 },
      { startMillis: start + 240_000, type: "potty", pee: true, duration: 50, deleted: true },
      { startMillis: start + 300_000, type: "diaper_change", pee: true, poo: true, duration: 60 },
    ], range, "potty");

    expect(potty.map(({ parameter, totalCount, totalDurationMillis }) => ({ parameter, totalCount, totalDurationMillis }))).toEqual([
      { parameter: "pee", totalCount: 2, totalDurationMillis: 40 },
      { parameter: "poo", totalCount: 2, totalDurationMillis: 50 },
      { parameter: "peeAndPoo", totalCount: 1, totalDurationMillis: 30 },
      { parameter: "empty", totalCount: 1, totalDurationMillis: 40 },
    ]);

    const diaper = buildStatisticsParameterBreakdown([
      { startMillis: start, type: "diaper_change", pee: true },
      { startMillis: start + 60_000, type: "diaper_change", poo: true },
      { startMillis: start + 120_000, type: "diaper_change", pee: true, poo: true },
      { startMillis: start + 180_000, type: "diaper_change" },
    ], range, "diaper_change");
    expect(diaper.map(({ parameter, totalCount }) => ({ parameter, totalCount }))).toEqual([
      { parameter: "wet", totalCount: 2 },
      { parameter: "dirty", totalCount: 2 },
      { parameter: "wetAndDirty", totalCount: 1 },
      { parameter: "dry", totalCount: 1 },
    ]);
  });

  it("uses native side durations and comparison series for feeding parameters", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 5]);
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const data = buildStatisticsParameterBreakdown([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "breastfeeding", side: "left", duration: 5, volume: 50 },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "breastfeeding", side: "left", leftDuration: 10, duration: 99, volume: 100 },
      { startMillis: new Date(2026, 2, 7, 9).getTime(), type: "breastfeeding", side: "both", leftDuration: 20, rightDuration: 30, duration: 50, volume: 200 },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "breastfeeding", side: "right", duration: 40, volume: 300 },
    ], range, "breastfeeding", { comparisonRange });

    expect(data.map(({ parameter, totalCount, totalDurationMillis, totalVolume }) => ({ parameter, totalCount, totalDurationMillis, totalVolume }))).toEqual([
      { parameter: "left", totalCount: 2, totalDurationMillis: 30, totalVolume: 300 },
      { parameter: "right", totalCount: 2, totalDurationMillis: 70, totalVolume: 500 },
    ]);
    expect(data[0]!.comparisonCountBins?.[0]?.activityCount).toBe(1);
    expect(data[0]!.comparisonDurationBins?.[0]?.durationMillis).toBe(5);
    expect(data[0]!.comparisonVolumeBins?.[0]?.volume).toBe(50);
    expect(data[0]!.timeOfDayBins[8]).toEqual({ hour: 8, count: 1, comparisonCount: 1, changePercent: 0 });
    expect(data[1]!.timeOfDayBins[9]?.count).toBe(1);
    expect(data[1]!.timeOfDayBins[10]?.count).toBe(1);
  });

  it("builds every native by-group metric and preserves requested groups", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 5]);
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const groups = buildStatisticsGroupBreakdown([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), type: "food", groupUid: "meal", duration: 10, volume: 20, amount: 1, amountUnit: "serving", reaction: "neutral" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", groupUid: "meal", duration: 30, volume: 40, amount: 2, amountUnit: "serving", reaction: "liked" },
      { startMillis: new Date(2026, 2, 7, 9).getTime(), type: "food", groupUid: "meal", duration: 50, volume: 60, amount: 100, amountUnit: "g", reaction: "disliked" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "food", groupUid: "other", amount: 99, amountUnit: "serving" },
      { startMillis: new Date(2026, 2, 7, 11).getTime(), type: "medicine", groupUid: "meal", amount: 99, amountUnit: "serving" },
    ], range, "food", { groupUids: ["empty", "meal", "meal"], comparisonRange });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ groupUid: "empty", totalCount: 0, totalDurationMillis: 0, totalVolume: 0, amounts: [] });
    expect(groups[1]).toMatchObject({
      groupUid: "meal",
      totalCount: 2,
      totalDurationMillis: 80,
      totalVolume: 100,
      reactions: {
        counts: { liked: 1, neutral: 0, disliked: 1 },
        total: 2,
        liked: { value: 1, comparisonValue: 0, changePercent: 0 },
      },
    });
    expect(groups[1]!.amounts.map(({ amountUnit, totalAmount }) => ({ amountUnit, totalAmount }))).toEqual([
      { amountUnit: "g", totalAmount: 100 },
      { amountUnit: "serving", totalAmount: 2 },
    ]);
    expect(groups[1]!.comparisonCountBins?.[0]?.activityCount).toBe(1);
    expect(groups[1]!.comparisonVolumeBins?.[0]?.volume).toBe(20);
    expect(groups[1]!.amounts[1]!.comparisonBins?.[0]?.amount).toBe(1);
    expect(groups[1]!.timeOfDayBins[8]).toEqual({ hour: 8, count: 1, comparisonCount: 1, changePercent: 0 });
    expect(() => buildStatisticsGroupBreakdown([], range, "food", { groupUids: [""] })).toThrow("must not be empty");
  });

  it("discovers only active groups in the selected or comparison range", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const groups = buildStatisticsGroupBreakdown([
      { startMillis: new Date(2026, 2, 7, 8).getTime(), type: "food", groupUid: "b" },
      { startMillis: new Date(2026, 2, 7, 9).getTime(), type: "food", groupUid: "a" },
      { startMillis: new Date(2026, 2, 6, 9).getTime(), type: "food", groupUid: "old" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), type: "food", groupUid: "deleted", deleted: true },
    ], range, "food");
    expect(groups.map((group) => group.groupUid)).toEqual(["a", "b"]);
  });

  it("counts only completed sleeps fully inside the native daytime window", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const data = buildStatisticsNapCountData([
      {
        startMillis: new Date(2026, 2, 7, 6).getTime(),
        endMillis: new Date(2026, 2, 7, 7).getTime(),
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 7, 17).getTime(),
        endMillis: new Date(2026, 2, 7, 18).getTime(),
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 7, 5, 59).getTime(),
        endMillis: new Date(2026, 2, 7, 7).getTime(),
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 7, 17).getTime(),
        endMillis: new Date(2026, 2, 7, 18, 1).getTime(),
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 7, 17).getTime(),
        endMillis: new Date(2026, 2, 8, 7).getTime(),
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 8, 8).getTime(),
        duration: 90 * 60 * 1000,
        type: "sleeping",
      },
      {
        startMillis: new Date(2026, 2, 8, 10).getTime(),
        endMillis: new Date(2026, 2, 8, 11).getTime(),
        type: "bottle",
      },
      {
        startMillis: new Date(2026, 2, 8, 12).getTime(),
        endMillis: new Date(2026, 2, 8, 13).getTime(),
        type: "sleeping",
        deleted: true,
      },
    ], range);

    expect(data.bins.map((bin) => bin.activityCount)).toEqual([2, 1]);
    expect(data.total).toEqual({ value: 3 });
    expect(data.averagePerDay).toEqual({ value: 1.5 });
  });

  it("compares native nap totals and averages per calendar day", () => {
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 5]);
    const range = dateRange([2026, 2, 7], [2026, 2, 8]);
    const data = buildStatisticsNapCountData([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), duration: 60_000, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), duration: 60_000, type: "sleeping" },
      { startMillis: new Date(2026, 2, 8, 8).getTime(), duration: 60_000, type: "sleeping" },
    ], range, { comparisonRange });

    expect(data.total).toEqual({ value: 2, comparisonValue: 1, changePercent: 100 });
    expect(data.averagePerDay).toEqual({ value: 1, comparisonValue: 1, changePercent: 0 });
  });

  it("validates nap daytime settings and sleep ranges", () => {
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    expect(() => buildStatisticsNapCountData([], range, { daytimeStartMinutes: 600, daytimeEndMinutes: 600 }))
      .toThrow("must be before");
    expect(() => buildStatisticsNapCountData([], range, { daytimeStartMinutes: 1.5 }))
      .toThrow("integer minute");
    expect(() => buildStatisticsNapCountData([], range, { daytimeEndMinutes: 1440 }))
      .toThrow("integer minute");
    expect(() => buildStatisticsNapCountData([
      {
        startMillis: new Date(2026, 2, 7, 8).getTime(),
        endMillis: new Date(2026, 2, 7, 7).getTime(),
        type: "sleeping",
      },
    ], range)).toThrow("must not precede");
  });

  it("builds native total, daytime, nighttime, and average nap duration data", () => {
    const hour = 60 * 60 * 1000;
    const comparisonRange = dateRange([2026, 2, 5], [2026, 2, 5]);
    const range = dateRange([2026, 2, 7], [2026, 2, 7]);
    const data = buildStatisticsSleepDurationData([
      { startMillis: new Date(2026, 2, 5, 8).getTime(), duration: hour, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 8).getTime(), duration: hour, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 10).getTime(), duration: 2 * hour, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 5).getTime(), duration: 2 * hour, type: "sleeping" },
      { startMillis: new Date(2026, 2, 7, 17).getTime(), duration: 2 * hour, type: "sleeping" },
    ], range, { comparisonRange });

    expect(data.total.totalDurationMillis).toEqual({ value: 7 * hour, comparisonValue: hour, changePercent: 600 });
    expect(data.total.averagePerDayMillis).toEqual({ value: 7 * hour, comparisonValue: hour, changePercent: 600 });
    expect(data.daytime.totalDurationMillis).toEqual({ value: 3 * hour, comparisonValue: hour, changePercent: 200 });
    expect(data.nighttime.totalDurationMillis).toEqual({ value: 4 * hour, comparisonValue: 0, changePercent: 0 });
    expect(data.nap.bins).toEqual([{
      periodStartMillis: range.fromMillis,
      averageDurationMillis: 1.5 * hour,
      activityCount: 2,
    }]);
    expect(data.nap.averagePerActivityMillis).toEqual({ value: 1.5 * hour, comparisonValue: hour, changePercent: 50 });
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
