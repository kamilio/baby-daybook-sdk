import scheduleData from "../data/sleep/sample-schedules.json" with { type: "json" };
import type {
  Baby,
  DatedSleepSchedule,
  DatedSleepTimeRange,
  SampleSleepSchedule,
  SleepClockTime,
  SleepScheduleSelectionInput,
  SleepTimeRange,
} from "./types.js";

let scheduleCache: readonly SampleSleepSchedule[] | undefined;

export function listSampleSleepSchedules(): readonly SampleSleepSchedule[] {
  scheduleCache ??= loadSchedules();
  return scheduleCache;
}

export function getSleepSchedulesForAge(ageMonths: number): readonly SampleSleepSchedule[] {
  const scheduleAge = scheduleAgeForBabyAge(ageMonths);
  return listSampleSleepSchedules().filter((schedule) => schedule.ageMonths === scheduleAge);
}

export function getExpandedSleepSchedulesForAge(ageMonths: number): readonly SampleSleepSchedule[] {
  const normalizedAge = normalizeBabyAge(ageMonths);
  const schedules = [...getSleepSchedulesForAge(normalizedAge)];
  const napCounts = new Set(schedules.map((schedule) => schedule.napCount));

  for (const offset of [1, 2]) {
    if (normalizedAge - offset >= 2) {
      const previous = getSleepSchedulesForAge(normalizedAge - offset).at(-1);
      if (previous && !napCounts.has(previous.napCount)) {
        schedules.unshift(previous);
        napCounts.add(previous.napCount);
      }
    }
    if (normalizedAge + offset <= 59) {
      const next = getSleepSchedulesForAge(normalizedAge + offset)[0];
      if (next && !napCounts.has(next.napCount)) {
        schedules.push(next);
        napCounts.add(next.napCount);
      }
    }
  }

  return schedules.sort((left, right) => left.napCount - right.napCount);
}

export function selectSleepSchedule(input: SleepScheduleSelectionInput): SampleSleepSchedule {
  if (!Number.isInteger(input.napCount) || input.napCount < 0) {
    throw new RangeError("napCount must be a non-negative integer");
  }
  const schedules = input.expanded === false
    ? getSleepSchedulesForAge(input.ageMonths)
    : getExpandedSleepSchedulesForAge(input.ageMonths);
  if (schedules.length === 0) throw new RangeError(`No sleep schedule is available for age ${input.ageMonths}`);
  const exact = schedules.find((schedule) => schedule.napCount === input.napCount);
  if (exact) return exact;
  return [...schedules].sort((left, right) => {
    const distance = Math.abs(left.napCount - input.napCount) - Math.abs(right.napCount - input.napCount);
    return distance || left.napCount - right.napCount;
  })[0]!;
}

export function babyAdjustedAgeMonths(baby: Baby, at: Date | number = Date.now()): number {
  const birthdayMillis = baby.isPremature && baby.expectedBirthdayMillis && baby.expectedBirthdayMillis > 0
    ? baby.expectedBirthdayMillis
    : baby.birthdayMillis;
  if (birthdayMillis === undefined) throw new RangeError("The baby must have a birthday");
  const birthday = new Date(birthdayMillis);
  const date = typeof at === "number" ? new Date(at) : at;
  let months = (date.getFullYear() - birthday.getFullYear()) * 12 + date.getMonth() - birthday.getMonth();
  if (date.getDate() < birthday.getDate()) months -= 1;
  return months;
}

export function selectSleepScheduleForBaby(
  baby: Baby,
  at: Date | number = Date.now(),
  napCount = baby.sleepPredictionNapCount,
): SampleSleepSchedule {
  if (napCount === undefined) throw new RangeError("The baby must have a sleep prediction nap count");
  return selectSleepSchedule({ ageMonths: babyAdjustedAgeMonths(baby, at), napCount });
}

export function materializeSleepSchedule(schedule: SampleSleepSchedule, day: Date | number): DatedSleepSchedule {
  const date = typeof day === "number" ? new Date(day) : day;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    naps: schedule.naps.map((range) => materializeRange(dayStart, range, false)),
    nightSleep: materializeRange(dayStart, schedule.nightSleep, true),
  };
}

function scheduleAgeForBabyAge(ageMonths: number): number {
  const age = normalizeBabyAge(ageMonths);
  if (age <= 23) return age;
  if (age <= 35) return 24;
  if (age <= 47) return 36;
  return 48;
}

function normalizeBabyAge(ageMonths: number): number {
  if (!Number.isFinite(ageMonths)) throw new RangeError("ageMonths must be finite");
  const age = Math.floor(ageMonths);
  if (age < 2 || age > 59) throw new RangeError("Sleep prediction supports ages 2 through 59 months");
  return age;
}

function materializeRange(dayStart: Date, range: SleepTimeRange, crossesMidnight: boolean): DatedSleepTimeRange {
  const start = atTime(dayStart, range.start);
  const end = atTime(dayStart, range.end);
  if (crossesMidnight && end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return { startMillis: start.getTime(), endMillis: end.getTime() };
}

function atTime(dayStart: Date, time: SleepClockTime): Date {
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), time.hour, time.minute);
}

function loadSchedules(): readonly SampleSleepSchedule[] {
  return deepFreeze(scheduleData as SampleSleepSchedule[]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
