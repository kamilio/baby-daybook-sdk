import type { ActivityPdfOptions, DailyAction } from "./types.js";

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
  const lines = [
    options.title ?? "Baby Daybook activity report",
    options.babyName ? `Baby: ${options.babyName}` : undefined,
    `Generated: ${formatTimestamp(generatedAt.getTime())}`,
    `Activities: ${rows.length}`,
    "",
    "Date and time       Type                 Duration   Amount       Notes",
    "--------------------------------------------------------------------------",
    ...rows.map(activityLine),
  ].filter((line): line is string => line !== undefined);
  const pages = chunk(lines, LINES_PER_PAGE);
  return encodePdf(pages.length === 0 ? [[""]] : pages);
}

function activityLine(activity: DailyAction): string {
  const durationMillis = activity.duration ?? Math.max(0, (activity.endMillis ?? activity.startMillis) - activity.startMillis);
  const duration = durationMillis > 0 ? formatDuration(durationMillis) : "";
  const amount = activity.amount === undefined
    ? activity.volume === undefined ? "" : String(activity.volume)
    : `${activity.amount}${activity.amountUnit ? ` ${activity.amountUnit}` : ""}`;
  return [
    fit(formatTimestamp(activity.startMillis), 19),
    fit(activity.type, 20),
    fit(duration, 10),
    fit(amount, 12),
    fit(activity.notes ?? "", 24),
  ].join(" ");
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

function formatDuration(millis: number): string {
  const totalMinutes = Math.round(millis / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
