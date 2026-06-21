import type { SleepTimeRange } from "./types.js";

export interface SleepRangeSample {
  startMillis: number;
  endMillis: number;
}

export function calculateAverageSleepRange(
  referenceRange: Readonly<SleepTimeRange>,
  sleeps: readonly Readonly<SleepRangeSample>[],
  timeZone = localTimeZone(),
): SleepTimeRange {
  if (sleeps.length === 0) throw new RangeError("Sleep list must not be empty");
  const referenceStartMinutes = clockMinutes(referenceRange.start.hour, referenceRange.start.minute, "reference start");
  clockMinutes(referenceRange.end.hour, referenceRange.end.minute, "reference end");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const ranges = sleeps.map((sleep) => toLocalRange(sleep, formatter));
  const hasCrossingRange = ranges.some((range) => range.startDay !== range.endDay);
  let startTotal = 0;
  let endTotal = 0;

  for (const range of ranges) {
    let startMinutes = range.startMinutes;
    let endMinutes = range.endMinutes;
    if (hasCrossingRange) {
      if (range.startDay !== range.endDay) {
        endMinutes += 24 * 60;
      } else if (startMinutes < referenceStartMinutes) {
        startMinutes += 24 * 60;
        endMinutes += 24 * 60;
      }
    }
    startTotal += startMinutes;
    endTotal += endMinutes;
  }

  return {
    start: minutesToClockTime(Math.trunc(startTotal / ranges.length)),
    end: minutesToClockTime(Math.trunc(endTotal / ranges.length)),
  };
}

function toLocalRange(sample: Readonly<SleepRangeSample>, formatter: Intl.DateTimeFormat) {
  if (!Number.isFinite(sample.startMillis) || !Number.isFinite(sample.endMillis)) {
    throw new RangeError("Sleep timestamps must be valid");
  }
  if (sample.endMillis < sample.startMillis) throw new RangeError("Sleep end must not precede its start");
  const start = localParts(sample.startMillis, formatter);
  const end = localParts(sample.endMillis, formatter);
  return {
    startDay: `${start.year}-${start.month}-${start.day}`,
    endDay: `${end.year}-${end.month}-${end.day}`,
    startMinutes: clockMinutes(start.hour, start.minute, "sleep start"),
    endMinutes: clockMinutes(end.hour, end.minute, "sleep end"),
  };
}

function localParts(millis: number, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(formatter.formatToParts(millis).map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
  };
}

function clockMinutes(hour: number, minute: number, name: string): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`${name} must contain an hour from 0 to 23 and a minute from 0 to 59`);
  }
  return hour * 60 + minute;
}

function minutesToClockTime(minutes: number) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hour: Math.floor(normalized / 60), minute: normalized % 60 };
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
