import scheduleData from "../data/sleep/sample-schedules.json" with { type: "json" };
import type {
  Baby,
  DatedSleepSchedule,
  DatedSleepTimeRange,
  DailyAction,
  PredictedSleep,
  SampleSleepSchedule,
  SleepClockTime,
  SleepScheduleSelectionInput,
  SleepPredictionInput,
  SleepPredictionResult,
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

export function predictSleepSchedule(input: SleepPredictionInput): SleepPredictionResult {
  const ageMonths = babyAdjustedAgeMonths(input.baby, input.day);
  const napCount = input.napCount ?? input.baby.sleepPredictionNapCount;
  if (napCount === undefined) throw new RangeError("The baby must have a sleep prediction nap count");
  const sampleSchedule = selectSleepSchedule({
    ageMonths,
    napCount,
  });
  const dated = materializeSleepSchedule(sampleSchedule, input.day);
  const nowMillis = input.now === undefined ? Date.now() : toMillis(input.now);
  const recordedNaps = getRecordedNaps(input.activities ?? [], dated, nowMillis);
  const sleeps: PredictedSleep[] = [];
  let previousEnd: number | undefined;

  for (let index = 0; index < dated.naps.length; index += 1) {
    const sampleNap = dated.naps[index]!;
    const recorded = recordedNaps[index];
    if (recorded) {
      const endMillis = recorded.endMillis ?? roundToFiveMinutes(recorded.startMillis + duration(sampleNap));
      sleeps.push({
        kind: "nap",
        number: index + 1,
        status: recorded.endMillis === undefined || recorded.inProgress ? "inProgress" : "recorded",
        startMillis: recorded.startMillis,
        endMillis,
      });
      previousEnd = endMillis;
      continue;
    }

    const samplePreviousEnd = index === 0 ? undefined : dated.naps[index - 1]!.endMillis;
    const wakeWindow = samplePreviousEnd === undefined ? undefined : sampleNap.startMillis - samplePreviousEnd;
    const startMillis = previousEnd === undefined || wakeWindow === undefined
      ? sampleNap.startMillis
      : roundToFiveMinutes(previousEnd + wakeWindow);
    const endMillis = roundToFiveMinutes(startMillis + duration(sampleNap));
    sleeps.push({ kind: "nap", number: index + 1, status: "predicted", startMillis, endMillis });
    previousEnd = endMillis;
  }

  const finalSampleEnd = dated.naps.at(-1)?.endMillis;
  const finalWakeWindow = finalSampleEnd === undefined
    ? 0
    : dated.nightSleep.startMillis - finalSampleEnd;
  const predictedBedtime = previousEnd === undefined
    ? dated.nightSleep.startMillis
    : roundToFiveMinutes(previousEnd + finalWakeWindow);
  const nightDuration = duration(dated.nightSleep);
  sleeps.push({
    kind: "nightSleep",
    status: "predicted",
    startMillis: predictedBedtime,
    endMillis: roundToFiveMinutes(predictedBedtime + nightDuration),
  });

  return { ageMonths, sampleSchedule, sleeps };
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

function getRecordedNaps(
  activities: readonly DailyAction[],
  schedule: DatedSleepSchedule,
  nowMillis: number,
): DailyAction[] {
  const dayStart = new Date(schedule.nightSleep.startMillis);
  dayStart.setHours(0, 0, 0, 0);
  return activities
    .filter((activity) => activity.type === "sleeping" && !activity.deleted)
    .filter((activity) => activity.startMillis >= dayStart.getTime() && activity.startMillis < schedule.nightSleep.startMillis)
    .filter((activity) => activity.startMillis <= nowMillis)
    .sort((left, right) => left.startMillis - right.startMillis);
}

function duration(range: DatedSleepTimeRange): number {
  return range.endMillis - range.startMillis;
}

function roundToFiveMinutes(millis: number): number {
  const increment = 5 * 60_000;
  return Math.round(millis / increment) * increment;
}

function toMillis(value: Date | number): number {
  return typeof value === "number" ? value : value.getTime();
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
