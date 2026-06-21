import type { DeletionFlag } from "./types.js";

export type StatisticsTimeInterval =
  | "last7Days"
  | "last14Days"
  | "last30Days"
  | "thisMonth"
  | "lastMonth"
  | "sinceBirthday";

export type StatisticsChartPeriod = "day" | "month" | "year";

export interface StatisticsDateRange {
  fromMillis: number;
  toMillis: number;
}

export interface StatisticsDateRangeNavigation {
  range: StatisticsDateRange;
  canLoadPrevious: boolean;
  canLoadNext: boolean;
}

export interface StatisticsChartBin {
  periodStartMillis: number;
  activityCount: number;
}

export interface StatisticsComparedValue {
  value: number;
  comparisonValue?: number;
  changePercent?: number;
}

export interface StatisticsActivityCountSummary {
  total: StatisticsComparedValue;
  averagePerDay: StatisticsComparedValue;
  averageTimeBetweenMillis: StatisticsComparedValue;
}

export interface StatisticsActivityCountSummaryOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
  timeBetweenFromEnd?: boolean;
}

export interface StatisticsVolumeBin {
  periodStartMillis: number;
  volume: number;
  activityCount: number;
}

export interface StatisticsVolumeSummary {
  total: StatisticsComparedValue;
  averagePerDay: StatisticsComparedValue;
  averagePerActivity: StatisticsComparedValue;
}

export interface StatisticsVolumeSummaryOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsVolumeByHourBin {
  hour: number;
  totalVolume: number;
  activityCount: number;
  averageVolume: number;
  comparisonTotalVolume?: number;
  comparisonActivityCount?: number;
  comparisonAverageVolume?: number;
  changePercent?: number;
}

export interface StatisticsVolumeByHourOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsAmountBin {
  periodStartMillis: number;
  amount: number;
  activityCount: number;
}

export interface StatisticsAmountSummary {
  total: StatisticsComparedValue;
  averagePerDay: StatisticsComparedValue;
  averagePerActivity: StatisticsComparedValue;
}

export interface StatisticsAmountSummaryOptions {
  amountUnit: string;
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsDurationBin {
  periodStartMillis: number;
  durationMillis: number;
  activityCount: number;
}

export interface StatisticsDurationSummary {
  averagePerDayMillis: StatisticsComparedValue;
}

export interface StatisticsDurationSummaryOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsNapCountData {
  bins: StatisticsChartBin[];
  total: StatisticsComparedValue;
  averagePerDay: StatisticsComparedValue;
}

export interface StatisticsNapCountOptions {
  daytimeStartMinutes?: number;
  daytimeEndMinutes?: number;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsSleepDurationMetric {
  bins: StatisticsDurationBin[];
  comparisonBins?: StatisticsDurationBin[];
  totalDurationMillis: StatisticsComparedValue;
  averagePerDayMillis: StatisticsComparedValue;
}

export interface StatisticsNapDurationBin {
  periodStartMillis: number;
  averageDurationMillis: number;
  activityCount: number;
}

export interface StatisticsNapDurationMetric {
  bins: StatisticsNapDurationBin[];
  comparisonBins?: StatisticsNapDurationBin[];
  averagePerActivityMillis: StatisticsComparedValue;
}

export interface StatisticsAwakeTimeBin {
  periodStartMillis: number;
  awakeTimeMillis: number;
  contributingDayCount: number;
  gapCount: number;
}

export interface StatisticsAwakeTimeData {
  bins: StatisticsAwakeTimeBin[];
  comparisonBins?: StatisticsAwakeTimeBin[];
}

export interface StatisticsAverageWakeBedTimeData {
  averageWakeUpHour?: number;
  averageBedTimeHour?: number;
  wakeUpSampleCount: number;
  bedTimeSampleCount: number;
}

export interface StatisticsSleepDurationData {
  total: StatisticsSleepDurationMetric;
  daytime: StatisticsSleepDurationMetric;
  nighttime: StatisticsSleepDurationMetric;
  nap: StatisticsNapDurationMetric;
  awakeTime: StatisticsAwakeTimeData;
  averageWakeBedTime: StatisticsAverageWakeBedTimeData;
}

export type StatisticsSleepDurationOptions = StatisticsNapCountOptions;

export interface StatisticsTemperaturePoint {
  timeMillis: number;
  temperature: number;
}

export interface StatisticsTemperaturePeriod {
  periodStartMillis: number;
  count: number;
  average: number;
  minimum: number;
  maximum: number;
}

export interface StatisticsTemperatureData {
  points: StatisticsTemperaturePoint[];
  periods: StatisticsTemperaturePeriod[];
  highestPeriodAverage?: number;
}

export type StatisticsReaction = "liked" | "neutral" | "disliked";

export interface StatisticsReactionDistribution {
  counts: Record<StatisticsReaction, number>;
  total: number;
  liked: StatisticsComparedValue;
}

export interface StatisticsReactionDistributionOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsTimeOfDayBin {
  hour: number;
  count: number;
  comparisonCount?: number;
  changePercent?: number;
}

export interface StatisticsTimeOfDayOptions {
  typeUid?: string;
  comparisonRange?: StatisticsDateRange;
}

export type StatisticsActivityParameter =
  | "pee"
  | "poo"
  | "peeAndPoo"
  | "empty"
  | "wet"
  | "dirty"
  | "wetAndDirty"
  | "dry"
  | "left"
  | "right"
  | "hairWash"
  | "noHairWash";

export interface StatisticsParameterSeries {
  parameter: StatisticsActivityParameter;
  totalCount: number;
  totalDurationMillis: number;
  totalVolume: number;
  countBins: StatisticsChartBin[];
  durationBins: StatisticsDurationBin[];
  volumeBins: StatisticsVolumeBin[];
  timeOfDayBins: StatisticsTimeOfDayBin[];
  comparisonCountBins?: StatisticsChartBin[];
  comparisonDurationBins?: StatisticsDurationBin[];
  comparisonVolumeBins?: StatisticsVolumeBin[];
}

export interface StatisticsParameterBreakdownOptions {
  comparisonRange?: StatisticsDateRange;
}

export interface StatisticsGroupAmountSeries {
  amountUnit: string;
  totalAmount: number;
  bins: StatisticsAmountBin[];
  comparisonBins?: StatisticsAmountBin[];
}

export interface StatisticsGroupSeries {
  groupUid: string;
  totalCount: number;
  totalDurationMillis: number;
  totalVolume: number;
  countBins: StatisticsChartBin[];
  durationBins: StatisticsDurationBin[];
  volumeBins: StatisticsVolumeBin[];
  amounts: StatisticsGroupAmountSeries[];
  reactions: StatisticsReactionDistribution;
  timeOfDayBins: StatisticsTimeOfDayBin[];
  comparisonCountBins?: StatisticsChartBin[];
  comparisonDurationBins?: StatisticsDurationBin[];
  comparisonVolumeBins?: StatisticsVolumeBin[];
}

export interface StatisticsGroupBreakdownOptions {
  groupUids?: readonly string[];
  comparisonRange?: StatisticsDateRange;
}

interface StatisticsActivityCountInput {
  startMillis: number;
  endMillis?: number;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsVolumeInput {
  startMillis: number;
  volume?: number;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsAmountInput {
  startMillis: number;
  amount?: number;
  amountUnit?: string;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsDurationInput {
  startMillis: number;
  endMillis?: number;
  duration?: number;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsTemperatureInput {
  startMillis: number;
  temperature?: number;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsReactionInput {
  startMillis: number;
  reaction?: string;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsTimeOfDayInput {
  startMillis: number;
  type: string;
  deleted?: DeletionFlag;
}

interface StatisticsParameterInput extends StatisticsDurationInput, StatisticsVolumeInput {
  side?: string;
  leftDuration?: number;
  rightDuration?: number;
  pee?: boolean;
  poo?: boolean;
  hairWash?: boolean;
}

interface StatisticsGroupInput extends StatisticsParameterInput, StatisticsAmountInput, StatisticsReactionInput {
  groupUid?: string;
}

const MINIMUM_TIME_BETWEEN_MILLIS = 5 * 60 * 1_000;

export function getStatisticsPredefinedDateRange(
  interval: StatisticsTimeInterval,
  babyBirthdayMillis?: number,
  nowMillis = Date.now(),
): StatisticsDateRange {
  assertFinite(nowMillis, "Current statistics time");
  const today = new Date(nowMillis);
  const todayEnd = endOfDay(today);
  let from: Date;
  let to = todayEnd;

  switch (interval) {
    case "last7Days":
      from = addCalendarDays(todayEnd, -6);
      break;
    case "last14Days":
      from = addCalendarDays(todayEnd, -13);
      break;
    case "last30Days":
      from = addCalendarDays(todayEnd, -29);
      break;
    case "thisMonth":
      from = firstDayOfMonth(today);
      to = lastDayOfMonth(today);
      break;
    case "lastMonth":
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = lastDayOfMonth(from);
      break;
    case "sinceBirthday": {
      if (babyBirthdayMillis === undefined) throw new RangeError("Baby birthday is required for the since-birthday statistics interval");
      assertFinite(babyBirthdayMillis, "Baby birthday");
      const birthday = new Date(babyBirthdayMillis);
      from = birthday.getTime() > todayEnd.getTime() ? todayEnd : birthday;
      break;
    }
    default:
      return assertNever(interval);
  }

  return { fromMillis: startOfDay(from).getTime(), toMillis: endOfDay(to).getTime() };
}

export function getNextStatisticsDateRange(range: Readonly<StatisticsDateRange>): StatisticsDateRange {
  validateRange(range);
  const from = new Date(range.fromMillis);
  const to = new Date(range.toMillis);
  const nextFrom = addCalendarDays(to, 1);
  const nextTo = isFullMonth(from, to)
    ? lastDayOfMonth(nextFrom)
    : addCalendarDays(nextFrom, differenceInCalendarDays(to, from));
  return { fromMillis: startOfDay(nextFrom).getTime(), toMillis: endOfDay(nextTo).getTime() };
}

export function getPreviousStatisticsDateRange(range: Readonly<StatisticsDateRange>): StatisticsDateRange {
  validateRange(range);
  const from = new Date(range.fromMillis);
  const to = new Date(range.toMillis);
  const previousTo = addCalendarDays(from, -1);
  const previousFrom = isFullMonth(from, to)
    ? firstDayOfMonth(previousTo)
    : addCalendarDays(previousTo, -differenceInCalendarDays(to, from));
  return { fromMillis: startOfDay(previousFrom).getTime(), toMillis: endOfDay(previousTo).getTime() };
}

export function canLoadNextStatisticsDateRange(
  range: Readonly<StatisticsDateRange> | undefined,
  nowMillis = Date.now(),
): boolean {
  if (!range) return false;
  validateRange(range);
  assertFinite(nowMillis, "Current statistics time");
  return range.toMillis < startOfDay(new Date(nowMillis)).getTime();
}

export function canLoadPreviousStatisticsDateRange(
  range: Readonly<StatisticsDateRange> | undefined,
  babyBirthdayMillis: number,
): boolean {
  if (!range) return false;
  validateRange(range);
  assertFinite(babyBirthdayMillis, "Baby birthday");
  return range.fromMillis > babyBirthdayMillis;
}

export function buildStatisticsDateRangeNavigation(
  range: Readonly<StatisticsDateRange>,
  babyBirthdayMillis: number,
  nowMillis = Date.now(),
): StatisticsDateRangeNavigation {
  validateRange(range);
  return {
    range: { ...range },
    canLoadPrevious: canLoadPreviousStatisticsDateRange(range, babyBirthdayMillis),
    canLoadNext: canLoadNextStatisticsDateRange(range, nowMillis),
  };
}

export function getStatisticsChartPeriod(range: Readonly<StatisticsDateRange>): StatisticsChartPeriod {
  validateRange(range);
  const differenceInDays = differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis));
  if (differenceInDays > 366) return "year";
  if (differenceInDays > 31) return "month";
  return "day";
}

export function canShowStatisticsComparison(range: Readonly<StatisticsDateRange>): boolean {
  return getStatisticsChartPeriod(range) !== "year";
}

export function getStatisticsComparisonDateRange(range: Readonly<StatisticsDateRange>): StatisticsDateRange {
  validateRange(range);
  const from = new Date(range.fromMillis);
  const to = new Date(range.toMillis);
  const inclusiveDays = differenceInCalendarDays(to, from) + 1;
  const comparisonTo = addCalendarDays(from, -1);
  const comparisonFrom = addCalendarDays(from, -inclusiveDays);
  return {
    fromMillis: startOfDay(comparisonFrom).getTime(),
    toMillis: endOfDay(comparisonTo).getTime(),
  };
}

export function getStatisticsQueryDateRange(
  range: Readonly<StatisticsDateRange>,
  showComparison: boolean,
): StatisticsDateRange {
  validateRange(range);
  if (!showComparison || !canShowStatisticsComparison(range)) return { ...range };
  return { fromMillis: getStatisticsComparisonDateRange(range).fromMillis, toMillis: range.toMillis };
}

export function getStatisticsChangePercent(current: number, comparison: number): number {
  assertFinite(current, "Current statistics value");
  assertFinite(comparison, "Comparison statistics value");
  if (current === 0 || comparison === 0) return 0;
  return current > comparison
    ? current / comparison * 100 - 100
    : 100 - comparison / current * 100;
}

export function buildStatisticsActivityCountBins(
  activities: readonly Readonly<{ startMillis: number; type: string; deleted?: DeletionFlag }>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): StatisticsChartBin[] {
  validateRange(range);
  const period = getStatisticsChartPeriod(range);
  const bins = createChartPeriodStarts(range, period).map((periodStartMillis) => ({ periodStartMillis, activityCount: 0 }));
  const binMap = new Map(bins.map((bin) => [bin.periodStartMillis, bin]));
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const periodStartMillis = periodStart(new Date(activity.startMillis), period).getTime();
    const bin = binMap.get(periodStartMillis);
    if (bin) bin.activityCount += 1;
  }
  return bins;
}

export function buildStatisticsActivityCountSummary(
  activities: readonly Readonly<StatisticsActivityCountInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsActivityCountSummaryOptions> = {},
): StatisticsActivityCountSummary {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = calculateActivityCountSummary(activities, range, options);
  const comparison = options.comparisonRange
    ? calculateActivityCountSummary(activities, options.comparisonRange, options)
    : undefined;
  return {
    total: comparedValue(current.total, comparison?.total),
    averagePerDay: comparedValue(current.averagePerDay, comparison?.averagePerDay),
    averageTimeBetweenMillis: comparedValue(
      current.averageTimeBetweenMillis,
      comparison?.averageTimeBetweenMillis,
    ),
  };
}

export function buildStatisticsVolumeBins(
  activities: readonly Readonly<StatisticsVolumeInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): StatisticsVolumeBin[] {
  validateRange(range);
  const period = getStatisticsChartPeriod(range);
  const bins = createChartPeriodStarts(range, period).map((periodStartMillis) => ({
    periodStartMillis,
    volume: 0,
    activityCount: 0,
  }));
  const binMap = new Map(bins.map((bin) => [bin.periodStartMillis, bin]));
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    const volume = activity.volume ?? 0;
    assertFinite(volume, "Activity volume");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const bin = binMap.get(periodStart(new Date(activity.startMillis), period).getTime());
    if (bin) {
      bin.volume += volume;
      bin.activityCount += 1;
    }
  }
  return bins;
}

export function buildStatisticsVolumeSummary(
  activities: readonly Readonly<StatisticsVolumeInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsVolumeSummaryOptions> = {},
): StatisticsVolumeSummary {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = calculateVolumeSummary(activities, range, options.typeUid);
  const comparison = options.comparisonRange
    ? calculateVolumeSummary(activities, options.comparisonRange, options.typeUid)
    : undefined;
  return {
    total: comparedValue(current.total, comparison?.total),
    averagePerDay: comparedValue(current.averagePerDay, comparison?.averagePerDay),
    averagePerActivity: comparedValue(current.averagePerActivity, comparison?.averagePerActivity),
  };
}

export function buildStatisticsVolumeByHour(
  activities: readonly Readonly<StatisticsVolumeInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsVolumeByHourOptions> = {},
): StatisticsVolumeByHourBin[] {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = calculateVolumeByHour(activities, range, options.typeUid);
  const comparison = options.comparisonRange
    ? calculateVolumeByHour(activities, options.comparisonRange, options.typeUid)
    : undefined;
  return current.map((value, hour) => comparison
    ? {
      hour,
      ...value,
      comparisonTotalVolume: comparison[hour]!.totalVolume,
      comparisonActivityCount: comparison[hour]!.activityCount,
      comparisonAverageVolume: comparison[hour]!.averageVolume,
      changePercent: getStatisticsChangePercent(value.averageVolume, comparison[hour]!.averageVolume),
    }
    : { hour, ...value });
}

export function buildStatisticsAmountBins(
  activities: readonly Readonly<StatisticsAmountInput>[],
  range: Readonly<StatisticsDateRange>,
  amountUnit: string,
  typeUid?: string,
): StatisticsAmountBin[] {
  validateRange(range);
  validateAmountUnit(amountUnit);
  const period = getStatisticsChartPeriod(range);
  const bins = createChartPeriodStarts(range, period).map((periodStartMillis) => ({
    periodStartMillis,
    amount: 0,
    activityCount: 0,
  }));
  const binMap = new Map(bins.map((bin) => [bin.periodStartMillis, bin]));
  for (const activity of activities) {
    if (activity.deleted
      || activity.amountUnit !== amountUnit
      || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    const amount = activity.amount ?? 0;
    assertFinite(amount, "Activity amount");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const bin = binMap.get(periodStart(new Date(activity.startMillis), period).getTime());
    if (bin) {
      bin.amount += amount;
      bin.activityCount += 1;
    }
  }
  return bins;
}

export function buildStatisticsAmountSummary(
  activities: readonly Readonly<StatisticsAmountInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsAmountSummaryOptions>,
): StatisticsAmountSummary {
  validateRange(range);
  validateAmountUnit(options.amountUnit);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = calculateAmountSummary(activities, range, options.amountUnit, options.typeUid);
  const comparison = options.comparisonRange
    ? calculateAmountSummary(activities, options.comparisonRange, options.amountUnit, options.typeUid)
    : undefined;
  return {
    total: comparedValue(current.total, comparison?.total),
    averagePerDay: comparedValue(current.averagePerDay, comparison?.averagePerDay),
    averagePerActivity: comparedValue(current.averagePerActivity, comparison?.averagePerActivity),
  };
}

export function buildStatisticsDurationBins(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): StatisticsDurationBin[] {
  validateRange(range);
  const period = getStatisticsChartPeriod(range);
  const bins = createChartPeriodStarts(range, period).map((periodStartMillis) => ({
    periodStartMillis,
    durationMillis: 0,
    activityCount: 0,
  }));
  const binMap = new Map(bins.map((bin) => [bin.periodStartMillis, bin]));
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    validateDurationActivity(activity);
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const bin = binMap.get(periodStart(new Date(activity.startMillis), period).getTime());
    if (bin) {
      bin.durationMillis += getActivityDurationMillis(activity);
      bin.activityCount += 1;
    }
  }
  return bins;
}

export function buildStatisticsDurationSummary(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsDurationSummaryOptions> = {},
): StatisticsDurationSummary {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = calculateAverageDurationPerDay(activities, range, options.typeUid);
  const comparison = options.comparisonRange
    ? calculateAverageDurationPerDay(activities, options.comparisonRange, options.typeUid)
    : undefined;
  return { averagePerDayMillis: comparedValue(current, comparison) };
}

export function buildStatisticsNapCountData(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsNapCountOptions> = {},
): StatisticsNapCountData {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const daytimeStartMinutes = options.daytimeStartMinutes ?? 6 * 60;
  const daytimeEndMinutes = options.daytimeEndMinutes ?? 18 * 60;
  validateStatisticsDaytime(daytimeStartMinutes, daytimeEndMinutes);
  const naps = activities.filter((activity) => activity.type === "sleeping"
    && isStatisticsNap(activity, daytimeStartMinutes, daytimeEndMinutes));
  const bins = buildStatisticsActivityCountBins(naps, range, "sleeping");
  const total = bins.reduce((sum, bin) => sum + bin.activityCount, 0);
  const comparisonBins = options.comparisonRange
    ? buildStatisticsActivityCountBins(naps, options.comparisonRange, "sleeping")
    : undefined;
  const comparisonTotal = comparisonBins?.reduce((sum, bin) => sum + bin.activityCount, 0);
  return {
    bins,
    total: comparedValue(total, comparisonTotal),
    averagePerDay: comparedValue(
      total / statisticsDayCount(range),
      options.comparisonRange && comparisonTotal !== undefined
        ? comparisonTotal / statisticsDayCount(options.comparisonRange)
        : undefined,
    ),
  };
}

export function buildStatisticsSleepDurationData(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsSleepDurationOptions> = {},
): StatisticsSleepDurationData {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const daytimeStartMinutes = options.daytimeStartMinutes ?? 6 * 60;
  const daytimeEndMinutes = options.daytimeEndMinutes ?? 18 * 60;
  validateStatisticsDaytime(daytimeStartMinutes, daytimeEndMinutes);
  const sleeping = activities.filter((activity) => activity.type === "sleeping" && !activity.deleted);
  for (const activity of sleeping) validateSleepRange(activity);
  const daytime = sleeping.filter((activity) => isStatisticsNap(activity, daytimeStartMinutes, daytimeEndMinutes));
  const nighttime = sleeping.filter((activity) => !isStatisticsNap(activity, daytimeStartMinutes, daytimeEndMinutes));
  return {
    total: buildSleepDurationMetric(sleeping, range, options.comparisonRange),
    daytime: buildSleepDurationMetric(daytime, range, options.comparisonRange),
    nighttime: buildSleepDurationMetric(nighttime, range, options.comparisonRange),
    nap: buildNapDurationMetric(daytime, range, options.comparisonRange),
    awakeTime: buildAwakeTimeData(
      sleeping,
      range,
      daytimeStartMinutes,
      daytimeEndMinutes,
      options.comparisonRange,
    ),
    averageWakeBedTime: buildAverageWakeBedTimeData(
      sleeping,
      range,
      daytimeStartMinutes,
      daytimeEndMinutes,
    ),
  };
}

export function buildStatisticsTemperatureData(
  activities: readonly Readonly<StatisticsTemperatureInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid = "temperature",
): StatisticsTemperatureData {
  validateRange(range);
  const period = getStatisticsChartPeriod(range);
  const points: StatisticsTemperaturePoint[] = [];
  const accumulators = new Map<number, { count: number; sum: number; minimum: number; maximum: number }>();
  for (const activity of activities) {
    if (activity.deleted || activity.type !== typeUid || activity.temperature === undefined) continue;
    assertFinite(activity.startMillis, "Activity start time");
    assertFinite(activity.temperature, "Activity temperature");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    points.push({ timeMillis: activity.startMillis, temperature: activity.temperature });
    const start = periodStart(new Date(activity.startMillis), period).getTime();
    const accumulator = accumulators.get(start);
    if (accumulator) {
      accumulator.count += 1;
      accumulator.sum += activity.temperature;
      accumulator.minimum = Math.min(accumulator.minimum, activity.temperature);
      accumulator.maximum = Math.max(accumulator.maximum, activity.temperature);
    } else {
      accumulators.set(start, {
        count: 1,
        sum: activity.temperature,
        minimum: activity.temperature,
        maximum: activity.temperature,
      });
    }
  }
  points.sort((left, right) => left.timeMillis - right.timeMillis);
  const periods = [...accumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([periodStartMillis, value]) => ({
      periodStartMillis,
      count: value.count,
      average: value.sum / value.count,
      minimum: value.minimum,
      maximum: value.maximum,
    }));
  return {
    points,
    periods,
    highestPeriodAverage: periods.length === 0
      ? undefined
      : Math.max(...periods.map((value) => value.average)),
  };
}

export function buildStatisticsReactionDistribution(
  activities: readonly Readonly<StatisticsReactionInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsReactionDistributionOptions> = {},
): StatisticsReactionDistribution {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = countReactions(activities, range, options.typeUid);
  const comparison = options.comparisonRange
    ? countReactions(activities, options.comparisonRange, options.typeUid)
    : undefined;
  return {
    counts: current,
    total: current.liked + current.neutral + current.disliked,
    liked: comparedValue(current.liked, comparison?.liked),
  };
}

export function buildStatisticsTimeOfDayDistribution(
  activities: readonly Readonly<StatisticsTimeOfDayInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsTimeOfDayOptions> = {},
): StatisticsTimeOfDayBin[] {
  validateRange(range);
  if (options.comparisonRange) validateRange(options.comparisonRange);
  const current = countActivitiesByHour(activities, range, options.typeUid);
  const comparison = options.comparisonRange
    ? countActivitiesByHour(activities, options.comparisonRange, options.typeUid)
    : undefined;
  return current.map((count, hour) => comparison
    ? {
      hour,
      count,
      comparisonCount: comparison[hour] ?? 0,
      changePercent: getStatisticsChangePercent(count, comparison[hour] ?? 0),
    }
    : { hour, count });
}

export function getStatisticsActivityParameters(typeUid: string): StatisticsActivityParameter[] {
  if (typeUid === "breastfeeding" || typeUid === "pump") return ["left", "right"];
  if (typeUid === "potty") return ["pee", "poo", "peeAndPoo", "empty"];
  if (typeUid === "diaper_change") return ["wet", "dirty", "wetAndDirty", "dry"];
  if (typeUid === "bath") return ["hairWash", "noHairWash"];
  return [];
}

export function matchesStatisticsActivityParameter(
  activity: Readonly<StatisticsParameterInput>,
  parameter: StatisticsActivityParameter,
): boolean {
  switch (parameter) {
    case "pee":
    case "wet":
      return activity.pee === true;
    case "poo":
    case "dirty":
      return activity.poo === true;
    case "peeAndPoo":
    case "wetAndDirty":
      return activity.pee === true && activity.poo === true;
    case "empty":
    case "dry":
      return activity.pee !== true && activity.poo !== true;
    case "left":
      return (activity.leftDuration ?? 0) > 0 || activity.side === "left" || activity.side === "both";
    case "right":
      return (activity.rightDuration ?? 0) > 0 || activity.side === "right" || activity.side === "both";
    case "hairWash":
      return activity.hairWash === true;
    case "noHairWash":
      return activity.hairWash !== true;
  }
}

export function buildStatisticsParameterBreakdown(
  activities: readonly Readonly<StatisticsParameterInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid: string,
  options: Readonly<StatisticsParameterBreakdownOptions> = {},
): StatisticsParameterSeries[] {
  getStatisticsChartPeriodStarts(range);
  if (options.comparisonRange) getStatisticsChartPeriodStarts(options.comparisonRange);
  return getStatisticsActivityParameters(typeUid).map((parameter) => {
    const parameterActivities = activities
      .filter((activity) => activity.type === typeUid && matchesStatisticsActivityParameter(activity, parameter))
      .map((activity) => withParameterDuration(activity, parameter));
    const countBins = buildStatisticsActivityCountBins(parameterActivities, range, typeUid);
    const durationBins = buildStatisticsDurationBins(parameterActivities, range, typeUid);
    const volumeBins = buildStatisticsVolumeBins(parameterActivities, range, typeUid);
    return {
      parameter,
      totalCount: countBins.reduce((total, bin) => total + bin.activityCount, 0),
      totalDurationMillis: durationBins.reduce((total, bin) => total + bin.durationMillis, 0),
      totalVolume: volumeBins.reduce((total, bin) => total + bin.volume, 0),
      countBins,
      durationBins,
      volumeBins,
      timeOfDayBins: buildStatisticsTimeOfDayDistribution(parameterActivities, range, {
        typeUid,
        comparisonRange: options.comparisonRange,
      }),
      ...(options.comparisonRange
        ? {
          comparisonCountBins: buildStatisticsActivityCountBins(parameterActivities, options.comparisonRange, typeUid),
          comparisonDurationBins: buildStatisticsDurationBins(parameterActivities, options.comparisonRange, typeUid),
          comparisonVolumeBins: buildStatisticsVolumeBins(parameterActivities, options.comparisonRange, typeUid),
        }
        : {}),
    };
  });
}

export function buildStatisticsGroupBreakdown(
  activities: readonly Readonly<StatisticsGroupInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid: string,
  options: Readonly<StatisticsGroupBreakdownOptions> = {},
): StatisticsGroupSeries[] {
  getStatisticsChartPeriodStarts(range);
  if (options.comparisonRange) getStatisticsChartPeriodStarts(options.comparisonRange);
  const groupUids = options.groupUids
    ? uniqueGroupUids(options.groupUids)
    : discoverStatisticsGroupUids(activities, range, typeUid, options.comparisonRange);
  return groupUids.map((groupUid) => {
    const groupActivities = activities.filter((activity) => activity.type === typeUid && activity.groupUid === groupUid);
    const countBins = buildStatisticsActivityCountBins(groupActivities, range, typeUid);
    const durationBins = buildStatisticsDurationBins(groupActivities, range, typeUid);
    const volumeBins = buildStatisticsVolumeBins(groupActivities, range, typeUid);
    const amountUnits = discoverStatisticsAmountUnits(groupActivities, range, options.comparisonRange);
    return {
      groupUid,
      totalCount: countBins.reduce((total, bin) => total + bin.activityCount, 0),
      totalDurationMillis: durationBins.reduce((total, bin) => total + bin.durationMillis, 0),
      totalVolume: volumeBins.reduce((total, bin) => total + bin.volume, 0),
      countBins,
      durationBins,
      volumeBins,
      amounts: amountUnits.map((amountUnit) => {
        const bins = buildStatisticsAmountBins(groupActivities, range, amountUnit, typeUid);
        return {
          amountUnit,
          totalAmount: bins.reduce((total, bin) => total + bin.amount, 0),
          bins,
          ...(options.comparisonRange
            ? { comparisonBins: buildStatisticsAmountBins(groupActivities, options.comparisonRange, amountUnit, typeUid) }
            : {}),
        };
      }),
      reactions: buildStatisticsReactionDistribution(groupActivities, range, {
        typeUid,
        comparisonRange: options.comparisonRange,
      }),
      timeOfDayBins: buildStatisticsTimeOfDayDistribution(groupActivities, range, {
        typeUid,
        comparisonRange: options.comparisonRange,
      }),
      ...(options.comparisonRange
        ? {
          comparisonCountBins: buildStatisticsActivityCountBins(groupActivities, options.comparisonRange, typeUid),
          comparisonDurationBins: buildStatisticsDurationBins(groupActivities, options.comparisonRange, typeUid),
          comparisonVolumeBins: buildStatisticsVolumeBins(groupActivities, options.comparisonRange, typeUid),
        }
        : {}),
    };
  });
}

export function getStatisticsChartPeriodStarts(range: Readonly<StatisticsDateRange>): number[] {
  validateRange(range);
  return createChartPeriodStarts(range, getStatisticsChartPeriod(range));
}

function withParameterDuration(
  activity: Readonly<StatisticsParameterInput>,
  parameter: StatisticsActivityParameter,
): StatisticsParameterInput {
  if (parameter !== "left" && parameter !== "right") return activity;
  const sideDuration = parameter === "left" ? activity.leftDuration : activity.rightDuration;
  return { ...activity, duration: sideDuration ?? getActivityDurationMillis(activity) };
}

function calculateVolumeByHour(
  activities: readonly Readonly<StatisticsVolumeInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): Array<{ totalVolume: number; activityCount: number; averageVolume: number }> {
  const values = Array.from({ length: 24 }, () => ({ totalVolume: 0, activityCount: 0, averageVolume: 0 }));
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const volume = activity.volume ?? 0;
    assertFinite(volume, "Activity volume");
    const value = values[new Date(activity.startMillis).getHours()]!;
    value.totalVolume += volume;
    value.activityCount += 1;
  }
  for (const value of values) {
    if (value.activityCount > 0) value.averageVolume = value.totalVolume / value.activityCount;
  }
  return values;
}

function uniqueGroupUids(groupUids: readonly string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const groupUid of groupUids) {
    if (!groupUid) throw new RangeError("Statistics group ID must not be empty");
    if (!seen.has(groupUid)) {
      seen.add(groupUid);
      values.push(groupUid);
    }
  }
  return values;
}

function discoverStatisticsGroupUids(
  activities: readonly Readonly<StatisticsGroupInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid: string,
  comparisonRange?: Readonly<StatisticsDateRange>,
): string[] {
  return [...new Set(activities.flatMap((activity) =>
    !activity.deleted
      && activity.type === typeUid
      && activity.groupUid
      && (isInStatisticsRange(activity.startMillis, range)
        || (comparisonRange !== undefined && isInStatisticsRange(activity.startMillis, comparisonRange)))
      ? [activity.groupUid]
      : []))].sort();
}

function discoverStatisticsAmountUnits(
  activities: readonly Readonly<StatisticsGroupInput>[],
  range: Readonly<StatisticsDateRange>,
  comparisonRange?: Readonly<StatisticsDateRange>,
): string[] {
  return [...new Set(activities.flatMap((activity) =>
    !activity.deleted
      && activity.amountUnit
      && (isInStatisticsRange(activity.startMillis, range)
        || (comparisonRange !== undefined && isInStatisticsRange(activity.startMillis, comparisonRange)))
      ? [activity.amountUnit]
      : []))].sort();
}

function isInStatisticsRange(millis: number, range: Readonly<StatisticsDateRange>): boolean {
  assertFinite(millis, "Activity start time");
  return millis >= range.fromMillis && millis <= range.toMillis;
}

function isStatisticsNap(
  activity: Readonly<StatisticsDurationInput>,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): boolean {
  if (activity.deleted) return false;
  const endMillis = validateSleepRange(activity);
  const start = new Date(activity.startMillis);
  const daytimeStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, daytimeStartMinutes);
  const daytimeEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, daytimeEndMinutes);
  return activity.startMillis >= daytimeStart.getTime() && endMillis <= daytimeEnd.getTime();
}

function validateSleepRange(activity: Readonly<StatisticsDurationInput>): number {
  assertFinite(activity.startMillis, "Activity start time");
  if (activity.duration !== undefined) assertFinite(activity.duration, "Activity duration");
  const endMillis = activity.endMillis ?? activity.startMillis + (activity.duration ?? 0);
  assertFinite(endMillis, "Activity end time");
  if (endMillis < activity.startMillis) throw new RangeError("Activity end time must not precede its start");
  return endMillis;
}

function buildSleepDurationMetric(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  comparisonRange?: Readonly<StatisticsDateRange>,
): StatisticsSleepDurationMetric {
  const bins = buildStatisticsDurationBins(activities, range, "sleeping");
  const comparisonBins = comparisonRange
    ? buildStatisticsDurationBins(activities, comparisonRange, "sleeping")
    : undefined;
  const totalDurationMillis = sumDurationBins(bins);
  const comparisonTotal = comparisonBins ? sumDurationBins(comparisonBins) : undefined;
  return {
    bins,
    ...(comparisonBins ? { comparisonBins } : {}),
    totalDurationMillis: comparedValue(totalDurationMillis, comparisonTotal),
    averagePerDayMillis: comparedValue(
      totalDurationMillis / statisticsDayCount(range),
      comparisonRange && comparisonTotal !== undefined
        ? comparisonTotal / statisticsDayCount(comparisonRange)
        : undefined,
    ),
  };
}

function buildNapDurationMetric(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  comparisonRange?: Readonly<StatisticsDateRange>,
): StatisticsNapDurationMetric {
  const bins = averageDurationBins(activities, range);
  const comparisonBins = comparisonRange ? averageDurationBins(activities, comparisonRange) : undefined;
  return {
    bins,
    ...(comparisonBins ? { comparisonBins } : {}),
    averagePerActivityMillis: comparedValue(
      averageDuration(activities, range),
      comparisonRange ? averageDuration(activities, comparisonRange) : undefined,
    ),
  };
}

function averageDurationBins(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
): StatisticsNapDurationBin[] {
  return buildStatisticsDurationBins(activities, range, "sleeping").map((bin) => ({
    periodStartMillis: bin.periodStartMillis,
    averageDurationMillis: bin.activityCount === 0 ? 0 : bin.durationMillis / bin.activityCount,
    activityCount: bin.activityCount,
  }));
}

function averageDuration(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
): number {
  const bins = buildStatisticsDurationBins(activities, range, "sleeping");
  const count = bins.reduce((sum, bin) => sum + bin.activityCount, 0);
  return count === 0 ? 0 : sumDurationBins(bins) / count;
}

function sumDurationBins(bins: readonly Readonly<StatisticsDurationBin>[]): number {
  return bins.reduce((sum, bin) => sum + bin.durationMillis, 0);
}

function buildAwakeTimeData(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
  comparisonRange?: Readonly<StatisticsDateRange>,
): StatisticsAwakeTimeData {
  const bins = buildAwakeTimeBins(activities, range, daytimeStartMinutes, daytimeEndMinutes);
  const comparisonBins = comparisonRange
    ? buildAwakeTimeBins(activities, comparisonRange, daytimeStartMinutes, daytimeEndMinutes)
    : undefined;
  return { bins, ...(comparisonBins ? { comparisonBins } : {}) };
}

function buildAwakeTimeBins(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): StatisticsAwakeTimeBin[] {
  const period = getStatisticsChartPeriod(range);
  const bins = getStatisticsChartPeriodStarts(range).map((periodStartMillis) => ({
    periodStartMillis,
    awakeTimeMillis: 0,
    contributingDayCount: 0,
    gapCount: 0,
  }));
  const binMap = new Map(bins.map((bin) => [bin.periodStartMillis, bin]));
  forEachStatisticsDay(range, (day) => {
    const selection = selectDaySleepActivities(activities, day, daytimeStartMinutes, daytimeEndMinutes);
    let gapTotal = 0;
    let gapCount = 0;
    for (let index = 1; index < selection.sequence.length; index += 1) {
      const previous = selection.sequence[index - 1];
      const current = selection.sequence[index];
      if (!previous || !current) continue;
      const gap = current.startMillis - validateSleepRange(previous);
      if (gap < MINIMUM_TIME_BETWEEN_MILLIS) continue;
      gapTotal += gap;
      gapCount += 1;
    }
    if (gapCount === 0) return;
    const bin = binMap.get(periodStart(day, period).getTime());
    if (!bin) return;
    bin.awakeTimeMillis += gapTotal / gapCount;
    bin.contributingDayCount += 1;
    bin.gapCount += gapCount;
  });
  return bins;
}

function buildAverageWakeBedTimeData(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): StatisticsAverageWakeBedTimeData {
  const wakeUpHours: number[] = [];
  const bedTimeHours: number[] = [];
  forEachStatisticsDay(range, (day) => {
    const selection = selectDaySleepActivities(activities, day, daytimeStartMinutes, daytimeEndMinutes);
    if (selection.wakeUp) wakeUpHours.push(nativeHourAndFraction(validateSleepRange(selection.wakeUp)));
    if (selection.bedTime) bedTimeHours.push(nativeHourAndFraction(selection.bedTime.startMillis));
  });
  return {
    ...(wakeUpHours.length > 0 ? { averageWakeUpHour: averageNumbers(wakeUpHours) } : {}),
    ...(bedTimeHours.length > 0 ? { averageBedTimeHour: averageNumbers(bedTimeHours) } : {}),
    wakeUpSampleCount: wakeUpHours.length,
    bedTimeSampleCount: bedTimeHours.length,
  };
}

function selectDaySleepActivities(
  activities: readonly Readonly<StatisticsDurationInput>[],
  day: Date,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): {
  wakeUp?: Readonly<StatisticsDurationInput>;
  bedTime?: Readonly<StatisticsDurationInput>;
  sequence: Readonly<StatisticsDurationInput>[];
} {
  const dayStartMillis = startOfDay(day).getTime();
  const dayEndMillis = endOfDay(day).getTime();
  const daytimeStartMillis = new Date(
    day.getFullYear(), day.getMonth(), day.getDate(), 0, daytimeStartMinutes,
  ).getTime();
  const daytimeEndMillis = new Date(
    day.getFullYear(), day.getMonth(), day.getDate(), 0, daytimeEndMinutes,
  ).getTime();
  let wakeUp: Readonly<StatisticsDurationInput> | undefined;
  let bedTime: Readonly<StatisticsDurationInput> | undefined;
  const naps: Readonly<StatisticsDurationInput>[] = [];
  for (const activity of activities) {
    const endMillis = validateSleepRange(activity);
    const nap = isStatisticsNap(activity, daytimeStartMinutes, daytimeEndMinutes);
    if (nap && activity.startMillis >= dayStartMillis && activity.startMillis <= dayEndMillis) {
      naps.push(activity);
      continue;
    }
    if (endMillis >= dayStartMillis && endMillis <= daytimeEndMillis
      && (!wakeUp || endMillis > validateSleepRange(wakeUp))) wakeUp = activity;
    if (activity.startMillis >= daytimeStartMillis && activity.startMillis <= dayEndMillis
      && (!bedTime || activity.startMillis < bedTime.startMillis)) bedTime = activity;
  }
  const sequence = [...new Set([...(wakeUp ? [wakeUp] : []), ...naps, ...(bedTime ? [bedTime] : [])])]
    .sort((left, right) => left.startMillis - right.startMillis);
  return { ...(wakeUp ? { wakeUp } : {}), ...(bedTime ? { bedTime } : {}), sequence };
}

function forEachStatisticsDay(range: Readonly<StatisticsDateRange>, callback: (day: Date) => void): void {
  for (let day = startOfDay(new Date(range.fromMillis)); day.getTime() <= range.toMillis; day = addCalendarDays(day, 1)) {
    callback(day);
  }
}

function nativeHourAndFraction(millis: number): number {
  const date = new Date(millis);
  return date.getHours() + date.getMinutes() / 59;
}

function averageNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateStatisticsDaytime(startMinutes: number, endMinutes: number): void {
  if (!Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes >= 24 * 60) {
    throw new RangeError("Daytime start must be an integer minute from 0 to 1439");
  }
  if (!Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes >= 24 * 60) {
    throw new RangeError("Daytime end must be an integer minute from 0 to 1439");
  }
  if (startMinutes >= endMinutes) throw new RangeError("Daytime start must be before daytime end");
}

function statisticsDayCount(range: Readonly<StatisticsDateRange>): number {
  return differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis)) + 1;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, -1);
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function firstDayOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isFullMonth(from: Date, to: Date): boolean {
  const lastDay = lastDayOfMonth(from);
  return from.getDate() === 1
    && to.getFullYear() === lastDay.getFullYear()
    && to.getMonth() === lastDay.getMonth()
    && to.getDate() === lastDay.getDate();
}

function differenceInCalendarDays(left: Date, right: Date): number {
  const leftUtc = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const rightUtc = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.trunc((leftUtc - rightUtc) / 86_400_000);
}

function createChartPeriodStarts(range: Readonly<StatisticsDateRange>, period: StatisticsChartPeriod): number[] {
  const starts: number[] = [];
  let current = periodStart(new Date(range.fromMillis), period);
  while (current.getTime() <= range.toMillis) {
    starts.push(current.getTime());
    current = addPeriod(current, period);
  }
  return starts;
}

function calculateActivityCountSummary(
  activities: readonly Readonly<StatisticsActivityCountInput>[],
  range: Readonly<StatisticsDateRange>,
  options: Readonly<StatisticsActivityCountSummaryOptions>,
): { total: number; averagePerDay: number; averageTimeBetweenMillis: number } {
  const matching = activities
    .filter((activity) => {
      if (activity.deleted || (options.typeUid !== undefined && activity.type !== options.typeUid)) return false;
      assertFinite(activity.startMillis, "Activity start time");
      if (activity.endMillis !== undefined) assertFinite(activity.endMillis, "Activity end time");
      return activity.startMillis >= range.fromMillis
        && activity.startMillis <= range.toMillis;
    })
    .sort((left, right) => left.startMillis - right.startMillis);
  const total = matching.length;
  const dayCount = differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis)) + 1;
  const byDay = new Map<number, Readonly<StatisticsActivityCountInput>[]>();
  for (const activity of matching) {
    const day = startOfDay(new Date(activity.startMillis)).getTime();
    const items = byDay.get(day);
    if (items) items.push(activity);
    else byDay.set(day, [activity]);
  }
  let timeBetweenTotal = 0;
  let timeBetweenCount = 0;
  for (const items of byDay.values()) {
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      if (!previous || !current) continue;
      const previousMillis = options.timeBetweenFromEnd && previous.endMillis !== undefined
        ? previous.endMillis
        : previous.startMillis;
      const interval = current.startMillis - previousMillis;
      if (interval >= MINIMUM_TIME_BETWEEN_MILLIS) {
        timeBetweenTotal += interval;
        timeBetweenCount += 1;
      }
    }
  }
  return {
    total,
    averagePerDay: total / dayCount,
    averageTimeBetweenMillis: timeBetweenCount === 0 ? 0 : timeBetweenTotal / timeBetweenCount,
  };
}

function calculateVolumeSummary(
  activities: readonly Readonly<StatisticsVolumeInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): { total: number; averagePerDay: number; averagePerActivity: number } {
  let total = 0;
  let activityCount = 0;
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    const volume = activity.volume ?? 0;
    assertFinite(volume, "Activity volume");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    total += volume;
    activityCount += 1;
  }
  const dayCount = differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis)) + 1;
  return {
    total,
    averagePerDay: total / dayCount,
    averagePerActivity: activityCount === 0 ? 0 : total / activityCount,
  };
}

function calculateAmountSummary(
  activities: readonly Readonly<StatisticsAmountInput>[],
  range: Readonly<StatisticsDateRange>,
  amountUnit: string,
  typeUid?: string,
): { total: number; averagePerDay: number; averagePerActivity: number } {
  let total = 0;
  let activityCount = 0;
  for (const activity of activities) {
    if (activity.deleted
      || activity.amountUnit !== amountUnit
      || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    const amount = activity.amount ?? 0;
    assertFinite(amount, "Activity amount");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    total += amount;
    activityCount += 1;
  }
  const dayCount = differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis)) + 1;
  return {
    total,
    averagePerDay: total / dayCount,
    averagePerActivity: activityCount === 0 ? 0 : total / activityCount,
  };
}

function calculateAverageDurationPerDay(
  activities: readonly Readonly<StatisticsDurationInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): number {
  let total = 0;
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    validateDurationActivity(activity);
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    total += getActivityDurationMillis(activity);
  }
  const dayCount = differenceInCalendarDays(new Date(range.toMillis), new Date(range.fromMillis)) + 1;
  return total / dayCount;
}

function countReactions(
  activities: readonly Readonly<StatisticsReactionInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): Record<StatisticsReaction, number> {
  const counts: Record<StatisticsReaction, number> = { liked: 0, neutral: 0, disliked: 0 };
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    if (isStatisticsReaction(activity.reaction)) counts[activity.reaction] += 1;
  }
  return counts;
}

function countActivitiesByHour(
  activities: readonly Readonly<StatisticsTimeOfDayInput>[],
  range: Readonly<StatisticsDateRange>,
  typeUid?: string,
): number[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const activity of activities) {
    if (activity.deleted || (typeUid !== undefined && activity.type !== typeUid)) continue;
    assertFinite(activity.startMillis, "Activity start time");
    if (activity.startMillis < range.fromMillis || activity.startMillis > range.toMillis) continue;
    const hour = new Date(activity.startMillis).getHours();
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

function comparedValue(value: number, comparisonValue?: number): StatisticsComparedValue {
  return comparisonValue === undefined
    ? { value }
    : { value, comparisonValue, changePercent: getStatisticsChangePercent(value, comparisonValue) };
}

function validateAmountUnit(amountUnit: string): void {
  if (!amountUnit.trim()) throw new RangeError("Amount unit must not be empty");
}

function validateDurationActivity(activity: Readonly<StatisticsDurationInput>): void {
  assertFinite(activity.startMillis, "Activity start time");
  if (activity.endMillis !== undefined) assertFinite(activity.endMillis, "Activity end time");
  if (activity.duration !== undefined) assertFinite(activity.duration, "Activity duration");
}

function getActivityDurationMillis(activity: Readonly<StatisticsDurationInput>): number {
  if (activity.duration !== undefined) return Math.max(0, activity.duration);
  if (activity.endMillis !== undefined) return Math.max(0, activity.endMillis - activity.startMillis);
  return 0;
}

function isStatisticsReaction(value: string | undefined): value is StatisticsReaction {
  return value === "liked" || value === "neutral" || value === "disliked";
}

function periodStart(date: Date, period: StatisticsChartPeriod): Date {
  if (period === "day") return startOfDay(date);
  if (period === "month") return firstDayOfMonth(date);
  return firstDayOfYear(date);
}

function addPeriod(date: Date, period: StatisticsChartPeriod): Date {
  if (period === "day") return addCalendarDays(date, 1);
  if (period === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return new Date(date.getFullYear() + 1, 0, 1);
}

function validateRange(range: Readonly<StatisticsDateRange>): void {
  assertFinite(range.fromMillis, "Statistics range start");
  assertFinite(range.toMillis, "Statistics range end");
  if (range.fromMillis > range.toMillis) throw new RangeError("Statistics range start must not be after its end");
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function assertNever(value: never): never {
  throw new RangeError(`Unsupported statistics interval: ${String(value)}`);
}
