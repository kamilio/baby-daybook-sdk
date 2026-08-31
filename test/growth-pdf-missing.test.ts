import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BabyDaybookClient,
  buildDevelopmentGrowthSummary,
  decodeFields,
  encodeFields,
  growthToPdf,
} from "../src/index.js";
import type { FetchLike, GrowthEntry, GrowthPdfOptions } from "../src/index.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const DAY = 86_400_000;
const ROOT = "babyData/babyUid_baby";
const OPTIONS = { generatedAt: START, babyName: "Synthetic growth fixture" };
const MEASUREMENTS = [
  { field: "weight", label: "Weight chart", metric: "5 kg", imperial: "11.02 lb" },
  { field: "height", label: "Height chart", metric: "60 cm", imperial: "23.62 in" },
  { field: "headSize", label: "Head-size chart", metric: "40 cm", imperial: "15.75 in" },
] as const;

function entry(uid: string, dateMillis: number, values: Partial<GrowthEntry>): GrowthEntry {
  return { uid, userUid: "user", babyUid: "baby", dateMillis, ...values };
}

function inspect(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const xref = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  return text;
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>([[ROOT, { uid: "baby", name: OPTIONS.babyName }]]);
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
      expect(recordPath.startsWith(`${ROOT}/growth/`)).toBe(true);
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
    if (recordPath === `${ROOT}/growth`) return Response.json({ documents: [...records]
      .filter(([storedPath]) => storedPath.startsWith(`${ROOT}/growth/`))
      .map(([storedPath, data]) => wire(storedPath, data)) });
    const record = records.get(recordPath);
    expect(record).toBeDefined();
    return Response.json(wire(recordPath, record!));
  };
  const client = new BabyDaybookClient({
    session: { idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 }, fetch,
  });
  return { baby: client.baby("baby"), records, writes };
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("growth PDF missing measurements", () => {
  it("keeps the latest genuine measurement after a height-only native record", async () => {
    const current = fixture();
    await current.baby.createGrowth({ uid: "earlier", dateMillis: START - DAY, weight: 5, height: 60, headSize: 40 }, START);
    await current.baby.createGrowth({ uid: "later", dateMillis: START, weight: 0, height: 62, headSize: 0, notes: "Height only" }, START);
    const summary = await current.baby.getDevelopmentGrowth();
    expect(summary.growth).toMatchObject({ weight: 5, height: 62, headSize: 40 });
    const before = structuredClone([...current.records]);
    const bytes = await current.baby.exportGrowthPdf(OPTIONS);
    const text = inspect(bytes);
    expect(text).toContain("Measurements: 2");
    expect(text).toContain("Weight chart: 1 points, min 5 kg, max 5 kg, latest 5 kg on 2026-08-30");
    expect(text).toContain("Head-size chart: 1 points, min 40 cm, max 40 cm, latest 40 cm on 2026-08-30");
    expect(text).toContain("Height chart: 2 points, min 60 cm, max 62 cm, latest 62 cm on 2026-08-31");
    const omitted = (await current.baby.listGrowth()).map((record) => record.uid === "later" ? { ...record, weight: undefined, headSize: undefined } : record);
    expect(bytes).toEqual(growthToPdf(omitted, OPTIONS));
    expect([...current.records]).toEqual(before);
    expect(current.writes).toHaveLength(2);
    expect(current.records.get(`${ROOT}/growth/later`)).toMatchObject({ weight: 0, height: 62, headSize: 0 });
  });

  for (const measurement of MEASUREMENTS) {
    for (const units of ["metric", "imperial"] as const) {
      for (const missing of [0, -1, undefined]) {
        it(`treats ${measurement.field}=${String(missing)} as absent in ${units} rows and trends`, () => {
          const earlier = entry("earlier", START - DAY, { weight: 5, height: 60, headSize: 40 });
          const later = entry("later", START, { weight: 6, height: 62, headSize: 41, [measurement.field]: missing, notes: "Partial measurement" });
          const records = [later, earlier];
          const before = structuredClone(records);
          const options: GrowthPdfOptions = units === "metric" ? OPTIONS : { ...OPTIONS, weightUnit: "lb", lengthUnit: "in" };
          const bytes = growthToPdf(records, options);
          const control = growthToPdf([{ ...later, [measurement.field]: undefined }, earlier], options);
          expect(bytes).toEqual(control);
          const text = inspect(bytes);
          const value = measurement[units];
          expect(text).toContain(`${measurement.label}: 1 points, min ${value}, max ${value}, latest ${value} on 2026-08-30`);
          expect(text).toContain("Measurements: 2");
          for (const other of MEASUREMENTS.filter((candidate) => candidate !== measurement)) expect(text).toContain(`${other.label}: 2 points`);
          expect(records).toEqual(before);
        });
      }
    }
  }

  it("retains dated rows and notes but reports no data for all-placeholder measurements", () => {
    const records = [entry("zeros", START, { weight: 0, height: 0, headSize: 0, notes: "No measurements today" })];
    const text = inspect(growthToPdf(records, OPTIONS));
    expect(text).toContain("Measurements: 1");
    expect(text).toContain("No measurements today");
    for (const measurement of MEASUREMENTS) expect(text).toContain(`${measurement.label}: no data`);
    expect(buildDevelopmentGrowthSummary(records).count).toBe(1);
  });

  it("selects the latest positive value independently across several incomplete records", () => {
    const records = [
      entry("height", START, { weight: 0, height: 62, headSize: 0 }),
      entry("weight", START - 2 * DAY, { weight: 5, height: 0, headSize: 0 }),
      entry("head", START - DAY, { weight: 0, height: 0, headSize: 40 }),
    ];
    const text = inspect(growthToPdf(records, OPTIONS));
    expect(text).toContain("Weight chart: 1 points, min 5 kg, max 5 kg, latest 5 kg on 2026-08-29");
    expect(text).toContain("Height chart: 1 points, min 62 cm, max 62 cm, latest 62 cm on 2026-08-31");
    expect(text).toContain("Head-size chart: 1 points, min 40 cm, max 40 cm, latest 40 cm on 2026-08-30");
    expect(buildDevelopmentGrowthSummary(records).growth).toMatchObject({ weight: 5, height: 62, headSize: 40 });
  });

  it("respects date filtering without backfilling an out-of-range measurement", () => {
    const records = [entry("old", START - DAY, { weight: 5 }), entry("current", START, { weight: 0, height: 62 })];
    const text = inspect(growthToPdf(records, { ...OPTIONS, fromMillis: START, toMillis: START }));
    expect(text).toContain("Measurements: 1");
    expect(text).toContain("Weight chart: no data");
    expect(text).toContain("Height chart: 1 points, min 62 cm, max 62 cm, latest 62 cm on 2026-08-31");
  });

  it("applies deletion options before selecting real measurements", () => {
    const records = [entry("deleted", START - DAY, { weight: 5, deleted: true }), entry("zero", START, { weight: 0 })];
    expect(inspect(growthToPdf(records, OPTIONS))).toContain("Weight chart: no data");
    const included = inspect(growthToPdf(records, { ...OPTIONS, includeDeleted: true }));
    expect(included).toContain("Measurements: 2");
    expect(included).toContain("Weight chart: 1 points, min 5 kg, max 5 kg, latest 5 kg on 2026-08-30");
  });

  it("retains chart-selection switches and valid values on partially empty records", () => {
    const records = [entry("height", START, { weight: 0, height: 62, headSize: 0 })];
    const text = inspect(growthToPdf(records, { ...OPTIONS, includeWeightChart: false, includeHeadSizeChart: false }));
    expect(text).not.toContain("Weight chart");
    expect(text).not.toContain("Head-size chart");
    expect(text).toContain("Height chart: 1 points");
    expect(text).toContain("62");
  });

  it("counts a positive measurement even when display precision rounds it to zero", () => {
    const records = [entry("small", START, { weight: 0.001 })];
    expect(inspect(growthToPdf(records, { ...OPTIONS, weightUnit: "lb" }))).toContain("Weight chart: 1 points");
  });
});
