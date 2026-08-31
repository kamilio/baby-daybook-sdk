import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activitiesToPdf, BabyDaybookClient, decodeFields, encodeFields } from "../src/index.js";
import type { DailyAction, DailyNote, FetchLike } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const ROOT = "babyData/babyUid_baby";
const OPTIONS = { generatedAt: START, timeZone: "UTC", includeDayTimeline: false, includeDaySummaries: false, includeActivities: false };
const PARAGRAPH = "A calm morning. ".repeat(10) + "ENDNOTE";

function note(text: string, values: Partial<DailyNote> = {}): DailyNote {
  return { uid: "20260831", userUid: "user", babyUid: "baby", note: text, ...values };
}

function pages(bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const xref = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  const streams = [...text.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
  expect(streams.length).toBeGreaterThan(0);
  expect(text).toContain(`/Count ${streams.length}`);
  return streams.map((match, index) => {
    const stream = match[2]!;
    expect(new TextEncoder().encode(stream)).toHaveLength(Number(match[1]));
    const lines = stream.split("\n").filter((line) => line.startsWith("(") && line.endsWith(") Tj"))
      .map((line) => line.slice(1, -4).replace(/\\([\\()])/g, "$1"));
    expect(lines.slice(-2)).toEqual(["", `Page ${index + 1} of ${streams.length}`]);
    expect(lines.length).toBeLessThanOrEqual(51);
    expect(752 - (lines.length - 1) * 14).toBeGreaterThanOrEqual(40);
    return lines.slice(0, -2);
  });
}

function noteLines(bytes: Uint8Array): string[] {
  const lines = pages(bytes).flat();
  const start = lines.findIndex((line) => line.startsWith("Day note: "));
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start);
}

function report(text: string): Uint8Array {
  return activitiesToPdf([], { ...OPTIONS, dailyNotes: [note(text)] });
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>([[ROOT, { uid: "baby", name: "Synthetic note fixture" }]]);
  const writes: Array<Record<string, unknown>> = [];
  const wire = (recordPath: string, data: Record<string, unknown>) => ({
    name: `projects/fixture/databases/(default)/documents/${recordPath}`, fields: encodeFields(data),
  });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    const documentPath = decodeURIComponent(url.pathname.split("/documents")[1] ?? "");
    if (documentPath === ":commit") {
      expect(init.method).toBe("POST");
      const submitted = JSON.parse(String(init.body)).writes;
      expect(submitted).toHaveLength(1);
      const write = submitted[0];
      const recordPath = write.update.name.split("/documents/")[1];
      expect(recordPath.startsWith(`${ROOT}/dailyNotes/`)).toBe(true);
      const fields = decodeFields(write.update.fields);
      const saved = write.updateMask ? { ...records.get(recordPath) } : {};
      for (const field of write.updateMask?.fieldPaths ?? Object.keys(fields)) {
        if (Object.hasOwn(fields, field)) saved[field] = fields[field];
        else delete saved[field];
      }
      records.set(recordPath, saved);
      writes.push(structuredClone(saved));
      return Response.json({ writeResults: [{ updateTime: "2026-08-31T12:00:00.000Z" }] });
    }
    expect(init.method ?? "GET").toBe("GET");
    const recordPath = documentPath.slice(1);
    if (["dailyActions", "dailyNotes", "daTypes"].some((collection) => recordPath === `${ROOT}/${collection}`)) {
      return Response.json({ documents: [...records]
        .filter(([storedPath]) => storedPath.startsWith(`${recordPath}/`))
        .map(([storedPath, data]) => wire(storedPath, data)) });
    }
    const record = records.get(recordPath);
    if (!record && recordPath.startsWith(`${ROOT}/dailyNotes/`)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
    expect(record).toBeDefined();
    return Response.json(wire(recordPath, record!));
  };
  const client = new BabyDaybookClient({
    session: { idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 }, fetch,
  });
  const baby = client.baby("baby");
  const connect = vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" }));
  const sdk = createBabyDaybookToolcraftSDK({
    env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services: { babyDaybook: { connect } },
  });
  return { baby, records, writes, sdk, connect };
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("daily-note PDF layout", () => {
  it.each(["client", "typed"])("wraps a publicly saved paragraph through the %s report", async (mode) => {
    const current = fixture();
    await current.baby.setDailyNote(PARAGRAPH, START, "UTC");
    expect(current.records.get(`${ROOT}/dailyNotes/20260831`)?.note).toBe(PARAGRAPH);
    const before = structuredClone([...current.records]);
    let bytes: Uint8Array;
    if (mode === "client") bytes = await current.baby.exportActivitiesPdf(OPTIONS);
    else {
      const response = await current.sdk.reports.activitiesPdf({ babyUid: "baby", timeZone: "UTC" });
      bytes = Buffer.from((response.data as unknown as { dataBase64: string }).dataBase64, "base64");
      expect(current.connect).toHaveBeenCalledTimes(1);
    }
    const lines = noteLines(bytes);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(`Day note: ${PARAGRAPH}`);
    expect(lines.at(-1)).toContain("ENDNOTE");
    expect([...current.records]).toEqual(before);
    expect(current.writes).toHaveLength(1);
  });

  it("wraps ordinary paragraphs at spaces without dropping or splitting words", () => {
    const lines = noteLines(report(PARAGRAPH));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(`Day note: ${PARAGRAPH}`);
    for (const line of lines.slice(0, -1)) expect(line.endsWith(" ")).toBe(true);
    expect(lines.flatMap((line) => line.trim().split(/ +/))).toEqual(`Day note: ${PARAGRAPH}`.split(" "));
  });

  it.each([
    { character: "W", count: 56, lengths: [56] },
    { character: "W", count: 57, lengths: [56, 1] },
    { character: "i", count: 239, lengths: [239] },
    { character: "i", count: 240, lengths: [239, 1] },
    { character: "@", count: 52, lengths: [52] },
    { character: "@", count: 53, lengths: [52, 1] },
  ])("uses measured Helvetica widths for $count $character characters", ({ character, count, lengths }) => {
    const lines = noteLines(report(`Heading\n${character.repeat(count)}`));
    expect(lines[0]).toBe("Day note: Heading");
    expect(lines.slice(1).map((line) => line.length)).toEqual(lengths);
    expect(lines.slice(1).join("")).toBe(character.repeat(count));
  });

  it("fits more narrow characters than wide characters on a physical line", () => {
    expect(noteLines(report("i".repeat(200)))).toHaveLength(1);
    const wide = noteLines(report("W".repeat(200)));
    expect(wide.length).toBeGreaterThan(3);
    expect(wide.join("")).toBe(`Day note: ${"W".repeat(200)}`);
  });

  it.each(["\n", "\r\n", "\r"])("preserves paragraph breaks with %j line endings", (newline) => {
    expect(noteLines(report(["First paragraph", "", "  Indented paragraph", "Last paragraph"].join(newline))))
      .toEqual(["Day note: First paragraph", "", "  Indented paragraph", "Last paragraph"]);
  });

  it("preserves boundary blank lines and expands tabs to four spaces", () => {
    expect(noteLines(report("\n\tIndented\n\nLast\n"))).toEqual(["Day note: ", "    Indented", "", "Last", ""]);
  });

  it.each([1, 43, 44, 45, 93, 94, 140])("paginates %s explicit note lines before drawing footers", (count) => {
    const lines = Array.from({ length: count }, (_, index) => `Line ${String(index).padStart(3, "0")}`);
    const bytes = report(lines.join("\n"));
    expect(pages(bytes)).toHaveLength(Math.ceil((count + 5) / 49));
    expect(noteLines(bytes)).toEqual([`Day note: ${lines[0]}`, ...lines.slice(1)]);
  });

  it("paginates a long wrapped paragraph without losing its ending", () => {
    const text = "A calm morning. ".repeat(1000) + "ENDNOTE";
    const bytes = report(text);
    expect(pages(bytes).length).toBeGreaterThan(1);
    expect(noteLines(bytes).join("")).toBe(`Day note: ${text}`);
    expect(pages(bytes).at(-1)!.at(-1)).toContain("ENDNOTE");
  });

  it("measures literal punctuation before escaping PDF text", () => {
    const text = 'A note (with parentheses) and \\ paths "quoted". '.repeat(30) + "ENDNOTE";
    const lines = noteLines(report(text));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(`Day note: ${text}`);
  });

  it("splits a long unbroken token without truncating its characters", () => {
    const text = `identifier:${"abcdef0123456789".repeat(80)}:ENDNOTE`;
    const lines = noteLines(report(text));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join("")).toBe(`Day note: ${text}`);
  });

  it("keeps daily notes between the timeline and summary without changing activities", () => {
    const activity: DailyAction = { uid: "bottle", userUid: "user", babyUid: "baby", type: "bottle", startMillis: START, volume: 123, amount: 0, notes: "Activity note" };
    const dailyNotes = [note(PARAGRAPH)];
    const before = structuredClone({ activity, dailyNotes });
    const lines = pages(activitiesToPdf([activity], { generatedAt: START, timeZone: "UTC", dailyNotes })).flat();
    const start = lines.findIndex((line) => line.startsWith("Day note: "));
    const end = lines.findIndex((line) => line.startsWith("Day summary:"));
    expect(lines.indexOf("Timeline")).toBeLessThan(start);
    expect(end).toBeGreaterThan(start + 1);
    expect(lines.slice(start, end).join("")).toBe(`Day note: ${PARAGRAPH}`);
    expect(lines.at(-1)).toContain("123 ml");
    expect(lines.at(-1)).toContain("Activity note");
    expect({ activity, dailyNotes }).toEqual(before);
  });

  it("keeps note-only days and date/deletion filters", () => {
    const dailyNotes = [note("Earlier", { uid: "20260830" }), note(PARAGRAPH), note("Deleted", { uid: "20260901", deleted: true }), note("Invalid", { uid: "not-a-day" })];
    const options = { ...OPTIONS, dailyNotes, fromMillis: START, toMillis: START + 86_400_000 };
    expect(noteLines(activitiesToPdf([], options)).join("")).toBe(`Day note: ${PARAGRAPH}`);
    const included = pages(activitiesToPdf([], { ...options, includeDeleted: true })).flat();
    expect(included).toContain("Day note: Deleted");
    expect(included).not.toContain("Day note: Earlier");
    expect(included).not.toContain("Day note: Invalid");
  });

  it("does not lay out hidden notes or whitespace-only notes", () => {
    const hidden = activitiesToPdf([], { ...OPTIONS, includeDayNotes: false, dailyNotes: [note(PARAGRAPH.repeat(100))] });
    expect(pages(hidden)).toHaveLength(1);
    expect(pages(hidden).flat().some((line) => line.startsWith("Day note:"))).toBe(false);
    expect(pages(report(" \t\r\n ")).flat().some((line) => line.startsWith("Day note:"))).toBe(false);
  });
});
