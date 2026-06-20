import type { BabyDaytimeRangeValidation, SleepClockTime, SleepTimeRange } from "./types.js";

export type BabyDaytimeRange = SleepTimeRange;

export const DEFAULT_BABY_DAYTIME_RANGE: Readonly<BabyDaytimeRange> = Object.freeze({
  start: Object.freeze({ hour: 7, minute: 0 }),
  end: Object.freeze({ hour: 20, minute: 0 }),
});

export const BABY_DAYTIME_RANGE_BOUNDS = Object.freeze({
  earliestStart: Object.freeze({ hour: 4, minute: 0 }),
  latestEnd: Object.freeze({ hour: 22, minute: 0 }),
  minimumDurationMinutes: 11 * 60,
  maximumDurationMinutes: 14 * 60,
  roundingIntervalMinutes: 15,
});

export function parseBabyDaytimeRange(value?: string): BabyDaytimeRange {
  const parsed = value === undefined ? undefined : parseRange(value);
  return parsed && isBabyDaytimeRangeValid(parsed) ? parsed : copyRange(DEFAULT_BABY_DAYTIME_RANGE);
}

export function formatBabyDaytimeRange(range: BabyDaytimeRange): string {
  assertClockTime(range.start, "start");
  assertClockTime(range.end, "end");
  return `${formatClockTime(range.start)}-${formatClockTime(range.end)}`;
}

export function babyDaytimeRangeDurationMinutes(range: BabyDaytimeRange): number {
  const start = clockTimeToMinutes(range.start);
  const end = clockTimeToMinutes(range.end);
  if (end === start) return 0;
  return end > start ? end - start : 24 * 60 - (start - end);
}

export function validateBabyDaytimeRange(range: BabyDaytimeRange): BabyDaytimeRangeValidation {
  const start = clockTimeToMinutes(range.start);
  const end = clockTimeToMinutes(range.end);
  const duration = babyDaytimeRangeDurationMinutes(range);
  const startInBounds = start >= clockTimeToMinutes(BABY_DAYTIME_RANGE_BOUNDS.earliestStart);
  const endInBounds = end <= clockTimeToMinutes(BABY_DAYTIME_RANGE_BOUNDS.latestEnd);
  const durationAtLeastMinimum = duration >= BABY_DAYTIME_RANGE_BOUNDS.minimumDurationMinutes;
  const durationAtMostMaximum = duration <= BABY_DAYTIME_RANGE_BOUNDS.maximumDurationMinutes;

  return {
    startInBounds,
    endInBounds,
    durationAtLeastMinimum,
    durationAtMostMaximum,
    valid: startInBounds && endInBounds && durationAtLeastMinimum && durationAtMostMaximum,
  };
}

export function isBabyDaytimeRangeValid(range: BabyDaytimeRange): boolean {
  try {
    return validateBabyDaytimeRange(range).valid;
  } catch {
    return false;
  }
}

export function roundBabyDaytimeRange(range: BabyDaytimeRange): BabyDaytimeRange {
  return {
    start: roundClockTime(range.start),
    end: roundClockTime(range.end),
  };
}

export function clampBabyDaytimeRange(current: BabyDaytimeRange, proposed: BabyDaytimeRange): BabyDaytimeRange {
  const minimumStart = clockTimeToHours(BABY_DAYTIME_RANGE_BOUNDS.earliestStart);
  const maximumEnd = clockTimeToHours(BABY_DAYTIME_RANGE_BOUNDS.latestEnd);
  const minimumDuration = BABY_DAYTIME_RANGE_BOUNDS.minimumDurationMinutes / 60;
  const maximumDuration = BABY_DAYTIME_RANGE_BOUNDS.maximumDurationMinutes / 60;
  const currentStart = clockTimeToHours(current.start);
  const currentEnd = clockTimeToHours(current.end);
  let start = clockTimeToHours(proposed.start);
  let end = clockTimeToHours(proposed.end);
  const startChanged = start !== currentStart;
  const endChanged = end !== currentEnd;
  const duration = end - start;

  if (duration < minimumDuration) {
    if (startChanged) {
      end = start + minimumDuration;
      if (end > maximumEnd) {
        end = maximumEnd;
        start = maximumEnd - minimumDuration;
      }
    } else if (endChanged) {
      start = end - minimumDuration;
      if (start < minimumStart) {
        start = minimumStart;
        end = minimumStart + minimumDuration;
      }
    }
  }

  if (duration > maximumDuration) {
    if (startChanged) {
      end = start + maximumDuration;
      if (end > maximumEnd) {
        end = maximumEnd;
        start = maximumEnd - maximumDuration;
      }
    } else if (endChanged) {
      start = end - maximumDuration;
      if (start < minimumStart) {
        start = minimumStart;
        end = minimumStart + maximumDuration;
      }
    }
  }

  return {
    start: hoursToClockTime(start),
    end: hoursToClockTime(end),
  };
}

function parseRange(value: string): BabyDaytimeRange | undefined {
  const parts = value.split("-");
  if (parts.length !== 2) return undefined;
  const start = parseClockTime(parts[0]!);
  const end = parseClockTime(parts[1]!);
  return start && end ? { start, end } : undefined;
}

function parseClockTime(value: string): SleepClockTime | undefined {
  const parts = value.split(":");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]!) || !/^\d+$/.test(parts[1]!)) return undefined;
  const time = { hour: Number(parts[0]), minute: Number(parts[1]) };
  return isClockTime(time) ? time : undefined;
}

function roundClockTime(time: SleepClockTime): SleepClockTime {
  assertClockTime(time, "time");
  const totalMinutes = Math.round(clockTimeToHours(time) * 60);
  const interval = BABY_DAYTIME_RANGE_BOUNDS.roundingIntervalMinutes;
  const roundedMinutes = Math.floor(totalMinutes / interval + 0.5) * interval;
  return minutesToClockTime(roundedMinutes);
}

function hoursToClockTime(hours: number): SleepClockTime {
  return minutesToClockTime(Math.round(hours * 60));
}

function minutesToClockTime(minutes: number): SleepClockTime {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hour: Math.floor(normalized / 60), minute: normalized % 60 };
}

function clockTimeToHours(time: SleepClockTime): number {
  return clockTimeToMinutes(time) / 60;
}

function clockTimeToMinutes(time: SleepClockTime): number {
  assertClockTime(time, "time");
  return time.hour * 60 + time.minute;
}

function formatClockTime(time: SleepClockTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function assertClockTime(time: SleepClockTime, name: string): void {
  if (!isClockTime(time)) throw new RangeError(`${name} must contain an hour from 0 to 23 and a minute from 0 to 59`);
}

function isClockTime(time: SleepClockTime): boolean {
  return Number.isInteger(time.hour) && time.hour >= 0 && time.hour <= 23 && Number.isInteger(time.minute) && time.minute >= 0 && time.minute <= 59;
}

function copyRange(range: Readonly<BabyDaytimeRange>): BabyDaytimeRange {
  return { start: { ...range.start }, end: { ...range.end } };
}
