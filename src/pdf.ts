import { resolveActivityTypeDisplayTitle } from "./activity-types.js";
import type { ActivityPdfOptions, ActivityType, DailyAction, DailyNote, GrowthEntry, GrowthPdfOptions, TimelinePdfOptions } from "./types.js";
import { formatBabyDaybookDayId } from "./day-id.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const LINE_HEIGHT = 14;
const LINES_PER_PAGE = 49;

export function activitiesToPdf(
  activities: readonly DailyAction[],
  options: ActivityPdfOptions = {},
): Uint8Array {
  const generatedAt = options.generatedAt === undefined ? new Date() : new Date(options.generatedAt);
  const rows = activities
    .filter((activity) => options.includeDeleted || !activity.deleted)
    .filter((activity) => options.fromMillis === undefined || activity.startMillis >= options.fromMillis)
    .filter((activity) => options.toMillis === undefined || activity.startMillis <= options.toMillis)
    .sort((left, right) => left.startMillis - right.startMillis);
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const activityTypes = new Map((options.activityTypes ?? []).map((type) => [type.uid, type]));
  const fromDayKey = options.fromMillis === undefined ? undefined : formatBabyDaybookDayId(options.fromMillis, timeZone);
  const toDayKey = options.toMillis === undefined ? undefined : formatBabyDaybookDayId(options.toMillis, timeZone);
  const dailyNotes = new Map((options.dailyNotes ?? [])
    .filter((note) => options.includeDeleted || !note.deleted)
    .filter((note) => /^\d{8}$/.test(note.uid))
    .filter((note) => fromDayKey === undefined || note.uid >= fromDayKey)
    .filter((note) => toDayKey === undefined || note.uid <= toDayKey)
    .map((note) => [note.uid, note]));
  const lines = [
    options.title ?? "Baby Daybook activity report",
    options.babyName ? `Baby: ${options.babyName}` : undefined,
    `Generated: ${formatTimestamp(generatedAt.getTime())}`,
    `Activities: ${rows.length}`,
    "",
    ...dailyListLines(rows, dailyNotes, activityTypes, options, timeZone),
  ].filter((line): line is string => line !== undefined);
  const pages = chunk(lines, LINES_PER_PAGE);
  return encodePdf(pages.length === 0 ? [[""]] : pages);
}

export function growthToPdf(
  entries: readonly GrowthEntry[],
  options: GrowthPdfOptions = {},
): Uint8Array {
  const generatedAt = options.generatedAt === undefined ? new Date() : new Date(options.generatedAt);
  const weightUnit = options.weightUnit ?? "kg";
  const lengthUnit = options.lengthUnit ?? "cm";
  const rows = entries
    .filter((entry) => options.includeDeleted || !entry.deleted)
    .filter((entry) => options.fromMillis === undefined || entry.dateMillis >= options.fromMillis)
    .filter((entry) => options.toMillis === undefined || entry.dateMillis <= options.toMillis)
    .sort((left, right) => left.dateMillis - right.dateMillis);
  const lines = [
    options.title ?? "Baby Daybook growth report",
    options.babyName ? `Baby: ${options.babyName}` : undefined,
    `Generated: ${formatTimestamp(generatedAt.getTime())}`,
    `Measurements: ${rows.length}`,
    "",
    `Date             Weight (${weightUnit}) Height (${lengthUnit}) Head (${lengthUnit}) Notes`,
    "--------------------------------------------------------------------------",
    ...rows.map((entry) => growthLine(entry, weightUnit, lengthUnit)),
    "",
    ...growthTrendLines(rows, options, weightUnit, lengthUnit),
  ].filter((line): line is string => line !== undefined);
  return encodePdf(chunk(lines, LINES_PER_PAGE));
}

export function timelineToPdf(
  activities: readonly DailyAction[],
  options: TimelinePdfOptions = {},
): Uint8Array {
  const generatedAt = options.generatedAt === undefined ? new Date() : new Date(options.generatedAt);
  const rows = activities
    .filter((activity) => options.includeDeleted || !activity.deleted)
    .filter((activity) => options.fromMillis === undefined || activity.startMillis >= options.fromMillis)
    .filter((activity) => options.toMillis === undefined || activity.startMillis <= options.toMillis)
    .sort((left, right) => left.startMillis - right.startMillis);
  const interval = options.hourLabelInterval ?? 3;
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const activityTypes = new Map((options.activityTypes ?? []).map((type) => [type.uid, type]));
  const lines = [
    options.title ?? "Baby Daybook timeline report",
    options.babyName ? `Baby: ${options.babyName}` : undefined,
    `Generated: ${formatTimestamp(generatedAt.getTime())}`,
    `Activities: ${rows.length}`,
    `Hour labels: every ${interval} hour${interval === 1 ? "" : "s"}`,
    "",
    ...timelineLines(rows, activityTypes, interval, timeZone),
  ].filter((line): line is string => line !== undefined);
  return encodePdf(chunk(lines, LINES_PER_PAGE));
}

function activityLine(activity: DailyAction, type?: ActivityType, timeZone = "UTC"): string {
  const durationMillis = activity.duration ?? Math.max(0, (activity.endMillis ?? activity.startMillis) - activity.startMillis);
  const duration = durationMillis > 0 ? formatDuration(durationMillis) : "";
  const amount = activity.amount === undefined
    ? activity.volume === undefined ? "" : String(activity.volume)
    : `${activity.amount}${activity.amountUnit ? ` ${activity.amountUnit}` : ""}`;
  return [
    fit(formatTimestampInZone(activity.startMillis, timeZone), 19),
    fit(resolveActivityTypeDisplayTitle(type ?? activity.type), 20),
    fit(duration, 10),
    fit(amount, 12),
    fit(activity.notes ?? "", 24),
  ].join(" ");
}

function dailyListLines(
  activities: readonly DailyAction[],
  notes: ReadonlyMap<string, DailyNote>,
  activityTypes: ReadonlyMap<string, ActivityType>,
  options: ActivityPdfOptions,
  timeZone: string,
): string[] {
  const days = groupActivitiesByDay(activities, timeZone);
  const noteOnlyDays = [...notes.keys()].filter((key) => !days.has(key)).sort();
  for (const key of noteOnlyDays) days.set(key, []);
  if (days.size === 0) return ["No activities or daily notes"];

  const lines: string[] = [];
  for (const [dayKey, dayActivities] of [...days].sort(([left], [right]) => left.localeCompare(right))) {
    if (lines.length > 0) lines.push("");
    lines.push(dayLabel(dayKey, options.babyBirthdayMillis, timeZone));
    if (options.includeDayTimeline !== false && dayActivities.length > 0) {
      lines.push("Timeline", hourLabels(options.hourLabelInterval ?? 3));
      lines.push(...dayActivities.map((activity) => `  ${formatTimeInZone(activity.startMillis, timeZone)} ${resolveActivityTypeDisplayTitle(activityTypes.get(activity.type) ?? activity.type)}`));
    }
    const note = notes.get(dayKey);
    if (options.includeDayNotes !== false && note?.note.trim()) lines.push(`Day note: ${note.note.trim()}`);
    if (options.includeDaySummaries !== false && dayActivities.length > 0) lines.push(...daySummaryLines(dayActivities, activityTypes));
    if (options.includeActivities !== false && dayActivities.length > 0) {
      lines.push("Date and time       Type                 Duration   Amount       Notes");
      lines.push("--------------------------------------------------------------------------");
      lines.push(...dayActivities.map((activity) => activityLine(activity, activityTypes.get(activity.type), timeZone)));
    }
  }
  return lines;
}

function groupActivitiesByDay(activities: readonly DailyAction[], timeZone: string): Map<string, DailyAction[]> {
  const grouped = new Map<string, DailyAction[]>();
  for (const activity of activities) {
    const key = formatBabyDaybookDayId(activity.startMillis, timeZone);
    grouped.set(key, [...(grouped.get(key) ?? []), activity]);
  }
  return grouped;
}

function daySummaryLines(activities: readonly DailyAction[], activityTypes: ReadonlyMap<string, ActivityType>): string[] {
  const grouped = new Map<string, { count: number; durationMillis: number }>();
  for (const activity of activities) {
    const title = resolveActivityTypeDisplayTitle(activityTypes.get(activity.type) ?? activity.type);
    const current = grouped.get(title) ?? { count: 0, durationMillis: 0 };
    const durationMillis = activity.duration ?? Math.max(0, (activity.endMillis ?? activity.startMillis) - activity.startMillis);
    grouped.set(title, { count: current.count + 1, durationMillis: current.durationMillis + durationMillis });
  }
  const values = [...grouped].sort(([left], [right]) => left.localeCompare(right));
  return [
    `Day summary: ${activities.length} activit${activities.length === 1 ? "y" : "ies"}`,
    ...values.map(([title, summary]) => `  ${title}: ${summary.count}${summary.durationMillis > 0 ? `, ${formatDuration(summary.durationMillis)}` : ""}`),
  ];
}

function dayLabel(dayKey: string, birthdayMillis: number | undefined, timeZone: string): string {
  if (birthdayMillis === undefined) return dayKeyToIsoDate(dayKey);
  const birthdayKey = formatBabyDaybookDayId(birthdayMillis, timeZone);
  const ageDays = Math.max(0, Math.round((dayKeyToUtcMillis(dayKey) - dayKeyToUtcMillis(birthdayKey)) / 86_400_000));
  return `${dayKeyToIsoDate(dayKey)} - age ${ageDays} day${ageDays === 1 ? "" : "s"}`;
}

function growthLine(entry: GrowthEntry, weightUnit: "kg" | "lb", lengthUnit: "cm" | "in"): string {
  return [
    fit(formatDate(entry.dateMillis), 16),
    fit(formatMeasurement(convertWeight(entry.weight, weightUnit)), 11),
    fit(formatMeasurement(convertLength(entry.height, lengthUnit)), 11),
    fit(formatMeasurement(convertLength(entry.headSize, lengthUnit)), 10),
    fit(entry.notes ?? "", 25),
  ].join(" ");
}

function growthTrendLines(entries: readonly GrowthEntry[], options: GrowthPdfOptions, weightUnit: "kg" | "lb", lengthUnit: "cm" | "in"): string[] {
  const lines: string[] = [];
  if (options.includeWeightChart !== false) lines.push(trendLine("Weight chart", entries, (entry) => convertWeight(entry.weight, weightUnit), weightUnit));
  if (options.includeHeightChart !== false) lines.push(trendLine("Height chart", entries, (entry) => convertLength(entry.height, lengthUnit), lengthUnit));
  if (options.includeHeadSizeChart !== false) lines.push(trendLine("Head-size chart", entries, (entry) => convertLength(entry.headSize, lengthUnit), lengthUnit));
  return lines;
}

function trendLine(label: string, entries: readonly GrowthEntry[], select: (entry: GrowthEntry) => number | undefined, unit: string): string {
  const values = entries.map((entry) => ({ dateMillis: entry.dateMillis, value: select(entry) })).filter((item): item is { dateMillis: number; value: number } => item.value !== undefined);
  if (values.length === 0) return `${label}: no data`;
  const minimum = Math.min(...values.map((item) => item.value));
  const maximum = Math.max(...values.map((item) => item.value));
  const latest = values[values.length - 1]!;
  return `${label}: ${values.length} points, min ${formatMeasurement(minimum)} ${unit}, max ${formatMeasurement(maximum)} ${unit}, latest ${formatMeasurement(latest.value)} ${unit} on ${formatDate(latest.dateMillis)}`;
}

function timelineLines(
  activities: readonly DailyAction[],
  activityTypes: ReadonlyMap<string, ActivityType>,
  interval: number,
  timeZone: string,
): string[] {
  const lines: string[] = [];
  let currentDay = "";
  for (const activity of activities) {
    const day = dayKeyToIsoDate(formatBabyDaybookDayId(activity.startMillis, timeZone));
    if (day !== currentDay) {
      if (lines.length > 0) lines.push("");
      currentDay = day;
      lines.push(day, hourLabels(interval), "Time        Type                     End      Duration   Notes");
      lines.push("--------------------------------------------------------------------------");
    }
    lines.push(timelineActivityLine(activity, activityTypes.get(activity.type), timeZone));
  }
  return lines.length === 0 ? ["No activities"] : lines;
}

function timelineActivityLine(activity: DailyAction, type: ActivityType | undefined, timeZone: string): string {
  const endMillis = activity.endMillis ?? (activity.duration === undefined ? undefined : activity.startMillis + activity.duration);
  const durationMillis = activity.duration ?? (endMillis === undefined ? 0 : Math.max(0, endMillis - activity.startMillis));
  return [
    fit(formatTimeInZone(activity.startMillis, timeZone), 11),
    fit(resolveActivityTypeDisplayTitle(type ?? activity.type), 24),
    fit(endMillis === undefined ? "" : formatTimeInZone(endMillis, timeZone), 8),
    fit(durationMillis > 0 ? formatDuration(durationMillis) : "", 10),
    fit(activity.notes ?? "", 20),
  ].join(" ");
}

function hourLabels(interval: number): string {
  const labels: string[] = [];
  for (let hour = 0; hour < 24; hour += interval) labels.push(`${String(hour).padStart(2, "0")}:00`);
  return `Hours: ${labels.join(" ")}`;
}

function encodePdf(pages: readonly (readonly string[])[]): Uint8Array {
  const objects = new Map<number, string>();
  const pageNumbers: number[] = [];
  for (let index = 0; index < pages.length; index += 1) pageNumbers.push(4 + index * 2);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, index) => {
    const pageNumber = pageNumbers[index]!;
    const streamNumber = pageNumber + 1;
    const stream = pageStream(lines, index + 1, pages.length);
    objects.set(pageNumber, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamNumber} 0 R >>`);
    objects.set(streamNumber, `<< /Length ${asciiLength(stream)} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n%BabyDaybookSDK\n";
  const offsets = [0];
  const objectCount = 3 + pages.length * 2;
  for (let number = 1; number <= objectCount; number += 1) {
    offsets[number] = asciiLength(pdf);
    pdf += `${number} 0 obj\n${objects.get(number)}\nendobj\n`;
  }
  const xrefOffset = asciiLength(pdf);
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let number = 1; number <= objectCount; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function pageStream(lines: readonly string[], page: number, pageCount: number): string {
  const content = [...lines, "", `Page ${page} of ${pageCount}`];
  return [
    "BT",
    "/F1 10 Tf",
    `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`,
    ...content.flatMap((line, index) => index === 0
      ? [`(${escapePdfText(line)}) Tj`]
      : [`0 -${LINE_HEIGHT} Td`, `(${escapePdfText(line)}) Tj`]),
    "ET",
  ].join("\n");
}

function escapePdfText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code < 32 || code > 126) return "?";
      if (character === "\\" || character === "(" || character === ")") return `\\${character}`;
      return character;
    })
    .join("");
}

function formatTimestamp(millis: number): string {
  return new Date(millis).toISOString().replace("T", " ").slice(0, 16);
}

function formatDate(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

function formatTimeInZone(millis: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(millis);
}

function formatTimestampInZone(millis: number, timeZone: string): string {
  return `${dayKeyToIsoDate(formatBabyDaybookDayId(millis, timeZone))} ${formatTimeInZone(millis, timeZone)}`;
}

function dayKeyToIsoDate(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function dayKeyToUtcMillis(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
}

function formatDuration(millis: number): string {
  const totalMinutes = Math.round(millis / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function convertWeight(value: number | undefined, unit: "kg" | "lb"): number | undefined {
  if (value === undefined) return undefined;
  return unit === "lb" ? value * 2.2046226218 : value;
}

function convertLength(value: number | undefined, unit: "cm" | "in"): number | undefined {
  if (value === undefined) return undefined;
  return unit === "in" ? value / 2.54 : value;
}

function formatMeasurement(value: number | undefined): string {
  if (value === undefined) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function fit(value: string, width: number): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (normalized.length > width) return `${normalized.slice(0, Math.max(0, width - 1))}…`;
  return normalized.padEnd(width);
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function asciiLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
