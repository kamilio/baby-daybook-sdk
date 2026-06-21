import type {
  ActivityType,
  DailyAction,
  Reminder,
  ReminderSchedule,
  ReminderScheduleContext,
} from "./types.js";

const DAY_MILLIS = 86_400_000;
export const BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS = 3 * 60 * 60_000;
export const BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS = 30 * 60_000;

export function normalizeReminderForSave(reminder: Reminder): Reminder {
  const basic = reminder.type === "basic";
  const repeatDays = reminder.type === "advanced_repeat_days" ? Math.max(1, reminder.repeatDays ?? 0) : 0;
  return {
    ...reminder,
    dateMillis: basic ? 0 : reminder.dateMillis,
    intervalMillis: basic ? reminder.intervalMillis : 0,
    repeatDays,
    repeatWeekdays: reminder.type === "advanced_repeat_weekdays" ? reminder.repeatWeekdays : "",
    dndFrom: basic ? reminder.dndFrom : "",
    dndTo: basic ? reminder.dndTo : "",
    dismissedMillis: 0,
  };
}

export function parseReminderWeekdays(value: string | undefined): number[] {
  if (!value) return [];
  return [...new Set(value.split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))];
}

export function isReminderMillisInDnd(reminder: Pick<Reminder, "dndFrom" | "dndTo">, millis: number): boolean {
  const from = parseTimeOfDay(reminder.dndFrom);
  const to = parseTimeOfDay(reminder.dndTo);
  if (from === undefined || to === undefined || from === to) return false;
  const date = new Date(millis);
  const minute = date.getHours() * 60 + date.getMinutes();
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export function getNextReminderMillis(reminder: Reminder, context: ReminderScheduleContext = {}): number | undefined {
  if (reminder.deleted) return undefined;
  const nowMillis = context.nowMillis ?? Date.now();
  switch (reminder.type) {
    case "basic":
      return basicOccurrence(reminder, context, nowMillis, "next");
    case "advanced":
      return reminder.dateMillis > nowMillis ? reminder.dateMillis : undefined;
    case "advanced_repeat_days":
      return nextRepeatDaysMillis(reminder, nowMillis);
    case "advanced_repeat_weekdays":
      return nextRepeatWeekdaysMillis(reminder, nowMillis);
  }
}

export function getExpiredReminderMillis(reminder: Reminder, context: ReminderScheduleContext = {}): number | undefined {
  if (reminder.deleted) return undefined;
  const nowMillis = context.nowMillis ?? Date.now();
  let candidate: number | undefined;
  switch (reminder.type) {
    case "basic":
      candidate = basicOccurrence(reminder, context, nowMillis, "expired");
      break;
    case "advanced":
      candidate = reminder.dateMillis < nowMillis ? reminder.dateMillis : undefined;
      break;
    case "advanced_repeat_days":
      candidate = expiredRepeatDaysMillis(reminder, nowMillis);
      break;
    case "advanced_repeat_weekdays":
      candidate = expiredRepeatWeekdaysMillis(reminder, nowMillis);
      break;
  }
  if (candidate === undefined || candidate <= (reminder.dismissedMillis ?? 0)) return undefined;
  if (reminder.type !== "basic" && activitySatisfiesOccurrence(candidate, context)) return undefined;
  return candidate;
}

export function resolveReminderSchedule(reminder: Reminder, context: ReminderScheduleContext = {}): ReminderSchedule {
  const nextMillis = getNextReminderMillis(reminder, context);
  const expiredMillis = getExpiredReminderMillis(reminder, context);
  return {
    reminder,
    nextMillis,
    expiredMillis,
    nextIsInDnd: nextMillis !== undefined && isReminderMillisInDnd(reminder, nextMillis),
    expiredIsInDnd: expiredMillis !== undefined && isReminderMillisInDnd(reminder, expiredMillis),
  };
}

export function sortReminderSchedules(schedules: readonly ReminderSchedule[]): ReminderSchedule[] {
  return [...schedules].sort((left, right) => {
    const leftMillis = left.expiredMillis ?? left.nextMillis ?? Number.POSITIVE_INFINITY;
    const rightMillis = right.expiredMillis ?? right.nextMillis ?? Number.POSITIVE_INFINITY;
    return leftMillis - rightMillis || left.reminder.uid.localeCompare(right.reminder.uid);
  });
}

export function getRelevantReminderSchedules(
  schedules: readonly ReminderSchedule[],
  nowMillis = Date.now(),
): ReminderSchedule[] {
  return [...schedules]
    .filter((schedule) => schedule.expiredMillis !== undefined
      || (schedule.nextMillis !== undefined
        && schedule.nextMillis - BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS < nowMillis))
    .sort(compareRelevantReminderSchedules);
}

export function getEarliestReminderDisplayMillis(
  schedules: readonly ReminderSchedule[],
  nowMillis = Date.now(),
): number | undefined {
  let earliest: number | undefined;
  for (const schedule of schedules) {
    if (schedule.nextMillis === undefined) continue;
    const displayMillis = schedule.nextMillis - BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS;
    if (displayMillis < nowMillis) continue;
    if (earliest === undefined || displayMillis < earliest) earliest = displayMillis;
  }
  return earliest;
}

function compareRelevantReminderSchedules(left: ReminderSchedule, right: ReminderSchedule): number {
  return (left.nextMillis ?? 0) - (right.nextMillis ?? 0)
    || (left.expiredMillis ?? 0) - (right.expiredMillis ?? 0);
}

function basicOccurrence(
  reminder: Reminder,
  context: ReminderScheduleContext,
  nowMillis: number,
  mode: "next" | "expired",
): number | undefined {
  const intervalMillis = reminder.intervalMillis ?? 0;
  const activityMillis = getActivityReferenceMillis(context.lastActivity, context.activityType, context.lastFeedingFromStart);
  if (intervalMillis <= 0 || activityMillis === undefined) return undefined;
  const candidate = activityMillis + intervalMillis;
  if (mode === "next") return candidate > nowMillis ? candidate : undefined;
  return candidate < nowMillis ? candidate : undefined;
}

function getActivityReferenceMillis(
  activity: DailyAction | undefined,
  activityType: ActivityType | undefined,
  lastFeedingFromStart = false,
): number | undefined {
  if (!activity || activity.deleted || activity.inProgress) return undefined;
  const hasDuration = activityType?.hasDuration ?? (activity.endMillis !== undefined || activity.duration !== undefined);
  const isFeeding = activityType?.category === "feeding";
  if (!hasDuration || (isFeeding && lastFeedingFromStart)) return activity.startMillis;
  return activity.endMillis ?? (activity.duration !== undefined ? activity.startMillis + activity.duration : activity.startMillis);
}

function activitySatisfiesOccurrence(candidate: number, context: ReminderScheduleContext): boolean {
  const activityMillis = getActivityReferenceMillis(context.lastActivity, context.activityType, context.lastFeedingFromStart);
  return activityMillis !== undefined && activityMillis > candidate;
}

function nextRepeatDaysMillis(reminder: Reminder, nowMillis: number): number | undefined {
  const repeatDays = reminder.repeatDays ?? 0;
  if (repeatDays <= 0) return undefined;
  let candidate = jumpCalendarDays(reminder.dateMillis, repeatDays, nowMillis);
  while (candidate <= nowMillis) candidate = addCalendarDays(candidate, repeatDays);
  return candidate;
}

function expiredRepeatDaysMillis(reminder: Reminder, nowMillis: number): number | undefined {
  const repeatDays = reminder.repeatDays ?? 0;
  if (repeatDays <= 0 || reminder.dateMillis >= nowMillis) return undefined;
  let candidate = jumpCalendarDays(reminder.dateMillis, repeatDays, nowMillis);
  while (candidate >= nowMillis) candidate = addCalendarDays(candidate, -repeatDays);
  while (addCalendarDays(candidate, repeatDays) < nowMillis) candidate = addCalendarDays(candidate, repeatDays);
  return candidate;
}

function jumpCalendarDays(startMillis: number, repeatDays: number, targetMillis: number): number {
  const estimatedRepeats = Math.max(0, Math.floor((targetMillis - startMillis) / (repeatDays * DAY_MILLIS)) - 1);
  return addCalendarDays(startMillis, estimatedRepeats * repeatDays);
}

function nextRepeatWeekdaysMillis(reminder: Reminder, nowMillis: number): number | undefined {
  const weekdays = parseReminderWeekdays(reminder.repeatWeekdays);
  if (weekdays.length === 0) return undefined;
  let candidate = timeOnLocalDay(nowMillis, reminder.dateMillis);
  for (let offset = 0; offset < 8; offset += 1) {
    if (candidate > nowMillis && weekdays.includes(candidateWeekday(candidate))) return candidate;
    candidate = addCalendarDays(candidate, 1);
  }
  return undefined;
}

function expiredRepeatWeekdaysMillis(reminder: Reminder, nowMillis: number): number | undefined {
  const weekdays = parseReminderWeekdays(reminder.repeatWeekdays);
  if (weekdays.length === 0) return undefined;
  let candidate = timeOnLocalDay(nowMillis, reminder.dateMillis);
  for (let offset = 0; offset < 8; offset += 1) {
    if (candidate < nowMillis && weekdays.includes(candidateWeekday(candidate))) return candidate;
    candidate = addCalendarDays(candidate, -1);
  }
  return undefined;
}

function timeOnLocalDay(dayMillis: number, timeMillis: number): number {
  const day = new Date(dayMillis);
  const time = new Date(timeMillis);
  day.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
  return day.getTime();
}

function addCalendarDays(millis: number, days: number): number {
  const date = new Date(millis);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function candidateWeekday(millis: number): number {
  return new Date(millis).getDay();
}

function parseTimeOfDay(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(?:TimeOfDay\()?([01]?\d|2[0-3]):([0-5]\d)/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}
