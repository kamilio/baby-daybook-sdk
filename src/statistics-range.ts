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

export function getStatisticsChartPeriodStarts(range: Readonly<StatisticsDateRange>): number[] {
  validateRange(range);
  return createChartPeriodStarts(range, getStatisticsChartPeriod(range));
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
