import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activitiesToCsv, activitiesToPdf, BabyDaybookClient, decodeFields, DEFAULT_ACTIVITY_TYPE_DEFINITIONS, encodeFields } from "../src/index.js";
import type { DailyAction, FetchLike, LogActivityInput } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const ROOT = "babyData/babyUid_baby";
const LEGACY_HEADERS = ["uid", "type", "startMillis", "endMillis", "duration", "side", "volume", "amount", "amountUnit", "reaction", "pee", "poo", "hairWash", "notes"] as const;
const OPTIONS = { generatedAt: START, timeZone: "UTC", includeDayTimeline: false, includeDaySummaries: false };

function action(values: Partial<DailyAction> = {}): DailyAction {
  return { uid: "reading", userUid: "user", babyUid: "baby", type: "temperature", startMillis: START, ...values };
}

function csvRecords(csv: string): Array<Record<string, string>> {
  const [header = [], ...rows] = csv.split("\n").map((line) => line.split(","));
  expect(header.slice(0, LEGACY_HEADERS.length)).toEqual(LEGACY_HEADERS);
  expect(header.slice(LEGACY_HEADERS.length)).toEqual(["temperature", "temperatureUnit"]);
  return rows.map((values) => {
    expect(values).toHaveLength(header.length);
    return Object.fromEntries(header.map((name, index) => [name, values[index]!]));
  });
}

function pdfRows(bytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(bytes);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const xref = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  return text.split("\n").filter((line) => /^\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line)).map((line) => line.slice(1, -4));
}

function pdfValue(bytes: Uint8Array): string {
  const rows = pdfRows(bytes);
  expect(rows).toHaveLength(1);
  return rows[0]!.slice(52, 64).trim();
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>([[ROOT, { uid: "baby", name: "Synthetic temperature fixture" }]]);
  const writes: Array<Record<string, unknown>> = [];
  for (const definition of DEFAULT_ACTIVITY_TYPE_DEFINITIONS) records.set(`${ROOT}/daTypes/${definition.uid}`, {
    ...definition, userUid: "user", babyUid: "baby", title: definition.uid,
    hasDuration: Number(definition.hasDuration), hasAmount: Number(definition.hasAmount), hasReaction: Number(definition.hasReaction),
  });
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
      expect(recordPath.startsWith(`${ROOT}/dailyActions/`)).toBe(true);
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

describe("temperature export fidelity", () => {
  it.each([37.45678901234567, 1.2345678901234568e-10])("keeps the complete %s reading and unit beyond the standard value column", async (temperature) => {
    const current = fixture();
    await current.baby.logActivity({ uid: "precise", type: "temperature", startMillis: START, temperature, notes: "Recorded reading" });
    expect(csvRecords(await current.baby.exportActivitiesCsv())[0]).toMatchObject({ temperature: String(temperature), temperatureUnit: "celsius" });
    const pdf = await current.baby.exportActivitiesPdf(OPTIONS);
    expect(pdfRows(pdf)[0]!.slice(52)).toBe(`${temperature} C Recorded reading${" ".repeat(8)}`);
    expect(current.records.get(`${ROOT}/dailyActions/precise`)?.temperature).toBe(temperature);
    expect(current.writes).toHaveLength(1);
  });

  it.each([37.4, 36.75, 0, -1.25, 40])("preserves a publicly logged %s Celsius reading in client and typed exports", async (temperature) => {
    const current = fixture();
    const logged = await current.baby.logActivity({ uid: "reading", type: "temperature", startMillis: START, temperature, notes: "Recorded reading" });
    expect(logged).toMatchObject({ temperature, amount: 0, volume: 0 });
    expect(current.records.get(`${ROOT}/dailyActions/reading`)).toMatchObject({ temperature, amount: 0, volume: 0 });
    const before = structuredClone([...current.records]);
    expect(csvRecords(await current.baby.exportActivitiesCsv())[0]).toMatchObject({ temperature: String(temperature), temperatureUnit: "celsius" });
    const pdf = await current.baby.exportActivitiesPdf(OPTIONS);
    expect(pdfValue(pdf)).toBe(`${temperature} C`);
    expect(pdfRows(pdf)[0]).toContain("Recorded reading");
    const csvResponse = await current.sdk.reports.activitiesCsv({ babyUid: "baby" });
    const csvData = csvResponse.data as unknown as { text: string };
    expect(csvRecords(csvData.text)[0]).toMatchObject({ temperature: String(temperature), temperatureUnit: "celsius" });
    const pdfResponse = await current.sdk.reports.activitiesPdf({ babyUid: "baby", timeZone: "UTC" });
    const pdfData = pdfResponse.data as unknown as { dataBase64: string };
    expect(pdfValue(Buffer.from(pdfData.dataBase64, "base64"))).toBe(`${temperature} C`);
    expect(current.connect).toHaveBeenCalledTimes(2);
    expect([...current.records]).toEqual(before);
    expect(current.writes).toHaveLength(1);
  });

  it.each(DEFAULT_ACTIVITY_TYPE_DEFINITIONS.filter((definition) => definition.uid !== "temperature"))(
    "preserves existing $uid exports without inventing temperature readings", async (definition) => {
      const current = fixture();
      const volumeType = ["bottle", "pump", "drink"].includes(definition.uid);
      const input: LogActivityInput = {
        uid: "sample", type: definition.uid, startMillis: START, notes: "Activity note",
        ...(volumeType ? { volume: 123 } : {}),
        ...(definition.hasAmount ? { amount: 3, amountUnit: "g" } : {}),
        ...(definition.hasReaction ? { reaction: "liked" } : {}),
        ...(["diaper_change", "potty"].includes(definition.uid) ? { pee: true, poo: true } : {}),
        ...(definition.uid === "bath" ? { hairWash: true } : {}),
        ...(definition.uid === "pump" ? { side: "left" } : {}),
      };
      if (definition.hasDuration) {
        await current.baby.startActivity(input);
        await current.baby.stopActivity("sample", START + 900_000);
      } else await current.baby.logActivity(input);
      const [stored] = await current.baby.activities.list();
      expect(stored).toBeDefined();
      const before = structuredClone([...current.records]);
      const writeCount = current.writes.length;
      const [csv] = csvRecords(await current.baby.exportActivitiesCsv());
      expect(csv).toMatchObject({ temperature: "", temperatureUnit: "" });
      for (const field of LEGACY_HEADERS) expect(csv![field]).toBe(String(stored![field] ?? ""));
      const pdf = await current.baby.exportActivitiesPdf(OPTIONS);
      expect(pdfValue(pdf)).toBe(volumeType ? "123 ml" : definition.hasAmount ? "3 g" : String(stored!.amount ?? ""));
      expect(pdfRows(pdf)[0]).toContain("Activity note");
      if (definition.hasDuration) expect(pdfRows(pdf)[0]!.slice(41, 51).trim()).toBe("15m");
      expect([...current.records]).toEqual(before);
      expect(current.writes).toHaveLength(writeCount);
    },
  );

  it("leaves an absent temperature blank despite unrelated amount and volume values", () => {
    const record = action({ amount: 9, amountUnit: "g", volume: 123 });
    expect(csvRecords(activitiesToCsv([record]))[0]).toMatchObject({ temperature: "", temperatureUnit: "", amount: "9", volume: "123" });
    expect(pdfValue(activitiesToPdf([record], OPTIONS))).toBe("");
  });

  it.each([0, 37.4])("does not export a stray %s temperature on a custom amount activity", (temperature) => {
    const record = action({ type: "custom", temperature, amount: 3, amountUnit: "g" });
    expect(csvRecords(activitiesToCsv([record]))[0]).toMatchObject({ temperature: "", temperatureUnit: "" });
    expect(pdfValue(activitiesToPdf([record], { ...OPTIONS, activityTypes: [{ uid: "custom", userUid: "user", babyUid: "baby", title: "Temperature" }] }))).toBe("3 g");
    expect(record.temperature).toBe(temperature);
  });

  it("uses Celsius and the full stored precision independently of the display title", () => {
    const record = action({ temperature: 37.456, amount: 0 });
    const options = { ...OPTIONS, activityTypes: [{ uid: "temperature", userUid: "user", babyUid: "baby", title: "Reading" }] };
    expect(pdfValue(activitiesToPdf([record], options))).toBe("37.456 C");
    expect(pdfRows(activitiesToPdf([record], options))[0]).toContain("Reading");
    expect(csvRecords(activitiesToCsv([record]))[0]).toMatchObject({ temperature: "37.456", temperatureUnit: "celsius" });
  });

  it("keeps CSV quoting and column positions while appending numeric temperatures and units", () => {
    const record = action({ temperature: 37.4, notes: 'First, "reading"\nSecond line' });
    const csv = activitiesToCsv([record]);
    expect(csv.split("\n")[0]).toBe([...LEGACY_HEADERS, "temperature", "temperatureUnit"].join(","));
    expect(csv).toContain(',"First, ""reading""\nSecond line",37.4,celsius');
    expect(activitiesToCsv([])).toBe([...LEGACY_HEADERS, "temperature", "temperatureUnit"].join(","));
  });

  it("retains client deletion and PDF date filtering", async () => {
    const current = fixture();
    await current.baby.logActivity({ uid: "current", type: "temperature", startMillis: START, temperature: 37.4 });
    await current.baby.logActivity({ uid: "deleted", type: "temperature", startMillis: START + 60_000, temperature: 38.2 });
    await current.baby.deleteActivity("deleted", START + 120_000);
    await current.baby.logActivity({ uid: "earlier", type: "temperature", startMillis: START - 86_400_000, temperature: 36.9 });
    expect(csvRecords(await current.baby.exportActivitiesCsv())).toHaveLength(2);
    expect(csvRecords(await current.baby.exportActivitiesCsv({ includeDeleted: true }))).toHaveLength(3);
    const options = { ...OPTIONS, fromMillis: START, toMillis: START + 120_000 };
    expect(pdfValue(await current.baby.exportActivitiesPdf(options))).toBe("37.4 C");
    expect(pdfRows(await current.baby.exportActivitiesPdf({ ...options, includeDeleted: true })).map((line) => line.slice(52, 64).trim())).toEqual(["37.4 C", "38.2 C"]);
  });

  it("keeps canonical units when a different report timezone is selected", () => {
    const record = action({ temperature: 37.4 });
    const pdf = activitiesToPdf([record], { ...OPTIONS, timeZone: "America/New_York" });
    expect(pdfRows(pdf)[0]).toContain("2026-08-31 08:00");
    expect(pdfValue(pdf)).toBe("37.4 C");
    expect(record).toEqual(action({ temperature: 37.4 }));
  });
});
