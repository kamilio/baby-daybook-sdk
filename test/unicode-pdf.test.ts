import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activitiesToPdf, BabyDaybookClient, decodeFields, encodeFields, growthToPdf, timelineToPdf } from "../src/index.js";
import type { DailyAction, FetchLike, GrowthEntry } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const OPTIONS = { generatedAt: START, timeZone: "UTC", includeDayTimeline: false, includeDaySummaries: false };
const EXAMPLES = [
  "Łucja żółw", "Zoë café", "e\u0301 A\u030a", "Αθηνά", "София", "Nguyễn",
  "ليلى", "שָׁלוֹם", "किरण", "ลูกน้อย", "Անի", "ნინო", "ሕፃን", "শিশু",
  "બાળક", "ਬੱਚਾ", "ಮಗು", "കുഞ്ഞ്", "ଶିଶୁ", "දරුවා", "குழந்தை", "శిశువు",
  "ເດັກ", "ទារក", "ကလေး", "བྱིས་པ", "ᠪᠠᠭ᠎ᠠ", "ܝܠܘܕܐ", "ބައްޕަ",
  "ᐊᓈᓇ", "ᎠᎹ", "ꆀꇐ", "宝宝", "さくら", "하늘", "👶🏽", "👨‍👩‍👧‍👦", "♥ € →",
];

function action(notes: string): DailyAction {
  return { uid: "fixture", babyUid: "baby", userUid: "user", type: "bottle", startMillis: START, volume: 90, notes };
}

function entry(notes: string): GrowthEntry {
  return { uid: "fixture", babyUid: "baby", userUid: "user", dateMillis: START, weight: 5, notes };
}

function hex(text: string): string {
  return Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
}

function pdfLines(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const offset = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
  expect(text.slice(offset, offset + 4)).toBe("xref");
  const entries = text.slice(offset).split("\n");
  const count = Number(entries[1]!.split(" ")[1]);
  for (let index = 1; index < count; index += 1) {
    const position = Number(entries[index + 2]!.slice(0, 10));
    expect(text.slice(position).startsWith(`${index} 0 obj\n`)).toBe(true);
  }
  for (const match of text.matchAll(/\/Length (\d+)[^\n]*\nstream\n/g)) {
    const end = match.index + match[0].length + Number(match[1]);
    expect(text.slice(end, end + 10)).toBe("\nendstream");
  }
  expect(text).toContain("/Subtype /Type0");
  expect(text).toContain("/ToUnicode");
  expect(text).toMatch(/\/FontFile[23]/);
  const lines = [...text.matchAll(/\/ActualText <FEFF([0-9A-F]*)>/g)].map((match) =>
    Buffer.from(match[1]!, "hex").swap16().toString("utf16le").replaceAll(/[\u2066\u2069]/g, ""));
  const glyphs = [...text.matchAll(/<([0-9A-F]{4})> Tj/g)];
  expect(glyphs.length).toBeGreaterThan(0);
  expect(glyphs.every((match) => match[1] !== "0000")).toBe(true);
  return lines;
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("Unicode PDF export fidelity", () => {
  it("preserves publicly logged names and notes through native storage and typed report exports", async () => {
    const root = "babyData/babyUid_baby";
    const records = new Map<string, Record<string, unknown>>([
      [root, { uid: "baby", name: "Łucja" }],
      [`${root}/growth/fixture`, { ...entry("żółw") }],
      [`${root}/daTypes/bottle`, { uid: "bottle", babyUid: "baby", userUid: "user", title: "Mleko żółw" }],
    ]);
    const wire = (path: string, data: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(data) });
    let writes = 0;
    const fetch: FetchLike = async (input, init = {}) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("firestore.googleapis.com");
      const path = decodeURIComponent(url.pathname.split("/documents")[1] ?? "");
      if (path === ":commit") {
        expect(init.method).toBe("POST");
        const submitted = JSON.parse(String(init.body)).writes;
        expect(submitted).toHaveLength(1);
        const update = submitted[0].update;
        records.set(update.name.split("/documents/")[1], decodeFields(update.fields));
        writes += 1;
        return Response.json({ writeResults: [{ updateTime: "2026-08-31T12:00:00.000Z" }] });
      }
      expect(init.method ?? "GET").toBe("GET");
      const recordPath = path.slice(1);
      if (["dailyActions", "dailyNotes", "daTypes", "growth"].some((collection) => recordPath === `${root}/${collection}`)) {
        return Response.json({ documents: [...records].filter(([stored]) => stored.startsWith(`${recordPath}/`)).map(([stored, data]) => wire(stored, data)) });
      }
      const record = records.get(recordPath);
      expect(record).toBeDefined();
      return Response.json(wire(recordPath, record!));
    };
    const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 }, fetch });
    const baby = client.baby("baby");
    const connect = vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" }));
    const sdk = createBabyDaybookToolcraftSDK({ env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services: { babyDaybook: { connect } } });
    await baby.logBottle({ uid: "fixture", startMillis: START, volume: 90, notes: "żółw" });
    expect(records.get(`${root}/dailyActions/fixture`)).toMatchObject({ notes: "żółw", volume: 90 });
    const before = structuredClone([...records]);
    expect(await baby.exportActivitiesCsv()).toContain("żółw");
    for (const bytes of [await baby.exportActivitiesPdf(OPTIONS), await baby.exportGrowthPdf(OPTIONS), await baby.exportTimelinePdf(OPTIONS)]) {
      const lines = pdfLines(bytes);
      expect(lines).toContain("Baby: Łucja");
      expect(lines.some((line) => line.includes("żółw"))).toBe(true);
    }
    for (const method of ["activitiesPdf", "growthPdf", "timelinePdf"] as const) {
      const response = await sdk.reports[method]({ babyUid: "baby" });
      const report = response.data as unknown as { dataBase64: string };
      expect(pdfLines(Buffer.from(report.dataBase64, "base64"))).toContain("Baby: Łucja");
    }
    expect([...records]).toEqual(before);
    expect(writes).toBe(1);
  });

  it.each(EXAMPLES)("embeds glyphs and retains logical text for %s in every report", (name) => {
    const options = { ...OPTIONS, babyName: name, title: `Report ${name}` };
    for (const bytes of [activitiesToPdf([action(name)], options), growthToPdf([entry(name)], options), timelineToPdf([action(name)], options)]) {
      const lines = pdfLines(bytes);
      expect(lines).toContain(`Baby: ${name}`);
      expect(lines).toContain(`Report ${name}`);
      expect(lines.some((line) => line.includes(name) && !line.startsWith("Baby:") && !line.startsWith("Report"))).toBe(true);
      expect(Buffer.from(bytes).toString("latin1")).not.toContain("(?ucja)");
    }
  });

  it("maps Polish glyphs, surrogate pairs, and ligatures to Unicode", () => {
    const text = Buffer.from(activitiesToPdf([], { ...OPTIONS, title: "Łucja żółw 👶 👨‍👩‍👧‍👦" })).toString("latin1");
    for (const value of ["Ł", "ż", "ó", "ł", "👶", "👨‍👩‍👧‍👦"]) expect(text).toContain(`<${hex(value)}>`);
  });

  it("keeps punctuation and mixed-direction text in logical order", () => {
    const title = "Łucja (ليلى 123) \\ שָׁלוֹם — 90 ml";
    expect(pdfLines(activitiesToPdf([], { ...OPTIONS, title }))).toContain(title);
  });

  it("keeps numeric growth columns on the left when the note is right-to-left", () => {
    const text = Buffer.from(growthToPdf([entry("ليلى")], OPTIONS)).toString("latin1");
    expect(text).toMatch(/BDC\nBT\n\/F2 10 Tf 1 0 0 1 40 [\d.]+ Tm <0001> Tj/);
    expect(text).toContain("/BaseFont /AAAAAC+NotoSans-Regular");
    expect(text).toContain("<0001> <0032>");
  });

  it("isolates right-to-left activity labels from adjacent numeric columns", () => {
    const bytes = activitiesToPdf([action("حليب")], { ...OPTIONS, activityTypes: [{ uid: "bottle", babyUid: "baby", userUid: "user", title: "حليب" }] });
    const text = Buffer.from(bytes).toString("latin1");
    const objects = new Map([...text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map((match) => [match[1]!, match[2]!]));
    const references = new Map([...text.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((match) => [match[1]!, match[2]!]));
    const maps = new Map([...references].filter(([name]) => name !== "F1").map(([name, reference]) => {
      const cmap = objects.get(reference)!.match(/\/ToUnicode (\d+)/)![1]!;
      return [name, new Map([...objects.get(cmap)!.matchAll(/<([A-F0-9]{4})> <([A-F0-9]+)>/g)].map((match) => [match[1]!, Buffer.from(match[2]!, "hex").swap16().toString("utf16le")]))];
    }));
    const span = text.match(/BDC\nBT\n([\s\S]*?)ET\nEMC/)![1]!;
    const visual = [...span.matchAll(/\/(F\d+) .*? Tm <([A-F0-9]+)> Tj/g)].map((match) => maps.get(match[1]!)!.get(match[2]!)).join("");
    expect(visual).toMatch(/^2026-08-31 12:00\s+بيلح\s+90 ml\s+بيلح\s*$/u);
  });

  it("never splits a combining sequence or emoji when shortening a table field", () => {
    for (const cluster of ["e\u0301", "👶🏽", "👨‍👩‍👧‍👦"]) {
      const lines = pdfLines(timelineToPdf([action(cluster.repeat(30))], OPTIONS));
      expect(lines.some((line) => line.endsWith(`${cluster.repeat(19)}…`))).toBe(true);
      expect(lines.join("\n")).not.toContain("\ufffd");
    }
  });

  it("wraps and paginates Unicode daily notes without losing text", () => {
    const note = "宝宝 e\u0301 👶🏽 ليلى ".repeat(600);
    const bytes = activitiesToPdf([], { ...OPTIONS, dailyNotes: [{ uid: "20260831", babyUid: "baby", userUid: "user", note }] });
    const lines = pdfLines(bytes);
    expect(lines.join("")).toBe(`Day note: ${note}`);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("/Count 1 ");
  }, 15_000);

  it("retains native font embedding and deterministic bytes across consecutive exports", () => {
    const options = { ...OPTIONS, babyName: "宝宝 Łucja 👶" };
    const first = activitiesToPdf([action("żółw")], options);
    activitiesToPdf([], { ...OPTIONS, babyName: "ليلى" });
    expect(activitiesToPdf([action("żółw")], options)).toEqual(first);
    const text = Buffer.from(first).toString("latin1");
    expect(text).toContain("/CIDFontType0C");
    expect(text).toContain("/CIDFontType2");
    expect(first.length).toBeLessThan(300_000);
  });

  it("reports unsupported visible characters instead of silently substituting them", () => {
    expect(() => activitiesToPdf([], { ...OPTIONS, babyName: "\u{10FFFF}" })).toThrow(/U\+10FFFF/);
  });

  it("leaves ASCII-only reports on the existing compact path", () => {
    const text = Buffer.from(activitiesToPdf([action("hello")], OPTIONS)).toString("latin1");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).not.toContain("/Subtype /Type0");
    expect(text).toContain("hello");
  });
});
