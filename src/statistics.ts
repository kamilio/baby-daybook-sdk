import type {
  ActivityMetricStatistics,
  ActivityStatisticsOptions,
  ActivityStatisticsReport,
  DailyAction,
  DailyActivityStatistics,
  NumericStatistics,
} from "./types.js";

const DAY_MILLIS = 86_400_000;

export function buildActivityStatistics(
  activities: readonly DailyAction[],
  options: ActivityStatisticsOptions = {},
): ActivityStatisticsReport {
  const daytimeStartMinutes = options.daytimeStartMinutes ?? 6 * 60;
  const daytimeEndMinutes = options.daytimeEndMinutes ?? 18 * 60;
  validateDaytime(daytimeStartMinutes, daytimeEndMinutes);

  const report: ActivityStatisticsReport = {
    count: 0,
    durationMillis: 0,
    amount: 0,
    volume: 0,
    byType: {},
    byGroup: {},
    byAmountUnit: {},
    byReaction: {},
    byHour: Array.from({ length: 24 }, () => 0),
    temperatures: { count: 0, sum: 0 },
    sleep: { count: 0, durationMillis: 0, daytimeDurationMillis: 0, nightDurationMillis: 0, napCount: 0 },
    days: [],
  };
  const days = new Map<string, DailyActivityStatistics>();

  for (const activity of activities) {
    if (!included(activity, options)) continue;
    const durationMillis = activityDuration(activity);
    const amount = activity.amount ?? 0;
    const volume = activity.volume ?? 0;
    addMetric(report, durationMillis, amount, volume);
    addMetric(report.byType[activity.type] ??= metric(), durationMillis, amount, volume);
    if (activity.groupUid) addMetric(report.byGroup[activity.groupUid] ??= metric(), durationMillis, amount, volume);
    if (activity.amountUnit && activity.amount !== undefined) addNumber(report.byAmountUnit[activity.amountUnit] ??= numeric(), activity.amount);
    if (activity.reaction) report.byReaction[activity.reaction] = (report.byReaction[activity.reaction] ?? 0) + 1;
    report.byHour[new Date(activity.startMillis).getHours()]! += 1;
    if (activity.temperature !== undefined) addNumber(report.temperatures, activity.temperature);

    const day = getDay(days, activity.startMillis, daytimeStartMinutes, daytimeEndMinutes);
    addMetric(day, durationMillis, amount, volume);

    if (activity.type === "sleeping") {
      const endMillis = activity.endMillis ?? activity.startMillis + durationMillis;
      const split = splitDaytime(activity.startMillis, endMillis, daytimeStartMinutes, daytimeEndMinutes);
      report.sleep.count += 1;
      report.sleep.durationMillis += durationMillis;
      report.sleep.daytimeDurationMillis += split.daytimeMillis;
      report.sleep.nightDurationMillis += split.nightMillis;
      if (split.daytimeMillis >= split.nightMillis) report.sleep.napCount += 1;
      day.daytimeSleepMillis += split.daytimeMillis;
      day.nightSleepMillis += split.nightMillis;
      day.awakeMillis = Math.max(0, daytimeEndMinutes * 60_000 - daytimeStartMinutes * 60_000 - day.daytimeSleepMillis);
    }
  }

  finalizeNumeric(report.temperatures);
  for (const value of Object.values(report.byAmountUnit)) finalizeNumeric(value);
  report.days = [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
  return report;
}

function included(activity: DailyAction, options: ActivityStatisticsOptions): boolean {
  if (activity.deleted) return false;
  if (options.fromMillis !== undefined && activity.startMillis < options.fromMillis) return false;
  if (options.toMillis !== undefined && activity.startMillis > options.toMillis) return false;
  return true;
}

function activityDuration(activity: DailyAction): number {
  if (activity.duration !== undefined) return Math.max(0, activity.duration);
  return Math.max(0, (activity.endMillis ?? activity.startMillis) - activity.startMillis);
}

function metric(): ActivityMetricStatistics {
  return { count: 0, durationMillis: 0, amount: 0, volume: 0 };
}

function addMetric(target: ActivityMetricStatistics, durationMillis: number, amount: number, volume: number): void {
  target.count += 1;
  target.durationMillis += durationMillis;
  target.amount += amount;
  target.volume += volume;
}

function numeric(): NumericStatistics {
  return { count: 0, sum: 0 };
}

function addNumber(target: NumericStatistics, value: number): void {
  target.count += 1;
  target.sum += value;
  target.minimum = target.minimum === undefined ? value : Math.min(target.minimum, value);
  target.maximum = target.maximum === undefined ? value : Math.max(target.maximum, value);
}

function finalizeNumeric(target: NumericStatistics): void {
  if (target.count > 0) target.average = target.sum / target.count;
}

function getDay(
  days: Map<string, DailyActivityStatistics>,
  millis: number,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): DailyActivityStatistics {
  const date = localDateKey(new Date(millis));
  const existing = days.get(date);
  if (existing) return existing;
  const created: DailyActivityStatistics = {
    date,
    ...metric(),
    daytimeSleepMillis: 0,
    nightSleepMillis: 0,
    awakeMillis: (daytimeEndMinutes - daytimeStartMinutes) * 60_000,
  };
  days.set(date, created);
  return created;
}

function splitDaytime(
  startMillis: number,
  endMillis: number,
  daytimeStartMinutes: number,
  daytimeEndMinutes: number,
): { daytimeMillis: number; nightMillis: number } {
  if (endMillis <= startMillis) return { daytimeMillis: 0, nightMillis: 0 };
  let daytimeMillis = 0;
  let cursor = startOfLocalDay(startMillis);
  const finalDay = startOfLocalDay(endMillis);
  while (cursor <= finalDay) {
    const daytimeStart = cursor + daytimeStartMinutes * 60_000;
    const daytimeEnd = cursor + daytimeEndMinutes * 60_000;
    daytimeMillis += overlap(startMillis, endMillis, daytimeStart, daytimeEnd);
    cursor += DAY_MILLIS;
  }
  return { daytimeMillis, nightMillis: endMillis - startMillis - daytimeMillis };
}

function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function startOfLocalDay(millis: number): number {
  const date = new Date(millis);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateDaytime(start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 * 60 || start >= end) {
    throw new RangeError("daytimeStartMinutes and daytimeEndMinutes must define a valid same-day range");
  }
}
