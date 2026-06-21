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

interface StatisticsActivityCountInput {
  startMillis: number;
  endMillis?: number;
  type: string;
  deleted?: boolean;
}

interface StatisticsVolumeInput {
  startMillis: number;
  volume?: number;
  type: string;
  deleted?: boolean;
}

interface StatisticsAmountInput {
  startMillis: number;
  amount?: number;
  amountUnit?: string;
  type: string;
  deleted?: boolean;
}

interface StatisticsDurationInput {
  startMillis: number;
  endMillis?: number;
  duration?: number;
  type: string;
  deleted?: boolean;
}

interface StatisticsTemperatureInput {
  startMillis: number;
  temperature?: number;
  type: string;
  deleted?: boolean;
}

interface StatisticsReactionInput {
  startMillis: number;
  reaction?: string;
  type: string;
  deleted?: boolean;
}

interface StatisticsTimeOfDayInput {
  startMillis: number;
  type: string;
  deleted?: boolean;
}

interface StatisticsParameterInput extends StatisticsDurationInput, StatisticsVolumeInput {
  side?: string;
  leftDuration?: number;
  rightDuration?: number;
  pee?: boolean;
  poo?: boolean;
  hairWash?: boolean;
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
  activities: readonly Readonly<{ startMillis: number; type: string; deleted?: boolean }>[],
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
