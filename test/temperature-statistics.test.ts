import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BabyDaybookClient,
  buildActivityStatistics,
  buildStatisticsTemperatureData,
  decodeFields,
  encodeFields,
} from "../src/index.js";
import type { ActivityStatisticsReport, DailyAction, FetchLike } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const MINUTE = 60_000;
const COLLECTION = "babyData/babyUid_baby/dailyActions";
const OTHER_TYPES = ["bottle", "pump", "drink", "diaper_change", "potty", "bath", "food", "medicine", "other", "custom_temperature"];

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const writes: Array<Record<string, unknown>> = [];
  for (const type of ["temperature", ...OTHER_TYPES]) {
    records.set(`babyData/babyUid_baby/daTypes/${type}`, {
      uid: type, userUid: "user", babyUid: "baby", title: type, hasDuration: 0,
    });
  }
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
      expect(recordPath.startsWith(`${COLLECTION}/`)).toBe(true);
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
    if (recordPath === COLLECTION) {
      return Response.json({ documents: [...records]
        .filter(([storedPath]) => storedPath.startsWith(`${COLLECTION}/`))
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
  const measurement = (uid = "measurement", temperature = 37.4, startMillis = START) =>
    baby.logActivity({ uid, type: "temperature", temperature, startMillis });
  const insights = async (fromMillis?: number, toMillis?: number) => {
    const result = await sdk.insights.activities({
      babyUid: "baby",
      ...(fromMillis === undefined ? {} : { fromMillis }),
      ...(toMillis === undefined ? {} : { toMillis }),
    });
    expect(connect).toHaveBeenCalled();
    return result.data as unknown as ActivityStatisticsReport;
  };
  return { baby, records, writes, measurement, insights };
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("temperature statistics from native mixed activity records", () => {
  it("preserves a real measurement when an ordinary bottle is logged and read back", async () => {
    const current = fixture();
    await current.measurement();
    const before = (await current.baby.getActivityStatistics()).temperatures;
    expect(before).toEqual({ count: 1, sum: 37.4, minimum: 37.4, maximum: 37.4, average: 37.4 });
    const bottle = await current.baby.logBottle({ uid: "bottle", startMillis: START + MINUTE, volume: 120 });
    expect(bottle.temperature).toBe(0);
    expect(current.records.get(`${COLLECTION}/bottle`)?.temperature).toBe(0);
    const report = await current.insights();
    expect(report).toMatchObject({ count: 2, volume: 120, temperatures: before });
    expect(report.byType.bottle).toMatchObject({ count: 1, volume: 120 });
    const chart = buildStatisticsTemperatureData(await current.baby.activities.list(), { fromMillis: START, toMillis: START + MINUTE });
    expect(chart.points).toHaveLength(1);
    expect(chart.periods[0]).toMatchObject({ average: 37.4, minimum: 37.4, maximum: 37.4 });
  });

  for (const type of OTHER_TYPES) {
    it(`ignores native zero and nonzero temperature fields on ${type} records`, async () => {
      const current = fixture();
      await current.measurement();
      const other = await current.baby.logActivity({ uid: "other", type, startMillis: START + MINUTE });
      expect(other.temperature).toBe(0);
      expect((await current.insights()).temperatures).toEqual({ count: 1, sum: 37.4, minimum: 37.4, maximum: 37.4, average: 37.4 });
      await current.baby.saveActivity({ ...other, temperature: 99 });
      expect((await current.insights()).temperatures.count).toBe(1);
      expect((await current.baby.activities.get("other"))?.temperature).toBe(99);
    });
  }

  it("leaves all temperature aggregates empty when history has only other activity types", async () => {
    const current = fixture();
    for (const type of OTHER_TYPES) await current.baby.logActivity({ uid: type, type, startMillis: START });
    const before = structuredClone([...current.records]);
    const report = await current.insights();
    expect(report.count).toBe(OTHER_TYPES.length);
    expect(report.temperatures).toEqual({ count: 0, sum: 0 });
    expect([...current.records]).toEqual(before);
    expect(current.writes).toHaveLength(OTHER_TYPES.length);
  });

  it("aggregates multiple measurements without changing volume or ordinary activity counts", async () => {
    const current = fixture();
    await current.measurement("first", 36.6);
    await current.measurement("second", 37.4, START + MINUTE);
    await current.baby.logBottle({ uid: "bottle", startMillis: START + 2 * MINUTE, volume: 120 });
    await current.baby.logPump({ uid: "pump", startMillis: START + 3 * MINUTE, volume: 80, side: "both" });
    const report = await current.insights();
    expect(report).toMatchObject({ count: 4, volume: 200, temperatures: { count: 2, sum: 74, average: 37, minimum: 36.6, maximum: 37.4 } });
    expect(report.byType.temperature?.count).toBe(2);
    expect(report.byType.bottle?.volume).toBe(120);
    expect(report.byType.pump?.volume).toBe(80);
    expect(report.days.reduce((count, day) => count + day.count, 0)).toBe(4);
  });

  it.each([0, -5, 36.5])("retains an explicit numeric measurement of %s rather than applying a value cutoff", async (temperature) => {
    const current = fixture();
    await current.measurement("measurement", temperature);
    await current.baby.logBottle({ uid: "bottle", volume: 120, startMillis: START });
    expect((await current.insights()).temperatures).toEqual({ count: 1, sum: temperature, minimum: temperature, maximum: temperature, average: temperature });
  });

  it("skips a measurement record with no temperature value", async () => {
    const current = fixture();
    await current.baby.saveActivity({ uid: "missing", userUid: "user", babyUid: "baby", type: "temperature", startMillis: START });
    const report = await current.insights();
    expect(report.count).toBe(1);
    expect(report.temperatures).toEqual({ count: 0, sum: 0 });
    expect(current.records.get(`${COLLECTION}/missing`)).not.toHaveProperty("temperature");
  });

  it("retains the native default for a temperature activity logged without an explicit value", async () => {
    const current = fixture();
    await current.baby.logActivity({ uid: "default", type: "temperature", startMillis: START });
    expect((await current.insights()).temperatures).toEqual({ count: 1, sum: 0, minimum: 0, maximum: 0, average: 0 });
  });

  it("honors inclusive date boundaries and ignores deleted measurements", async () => {
    const current = fixture();
    await current.measurement("before", 99, START - 1);
    await current.measurement("first", 36.6, START);
    await current.measurement("last", 37.4, START + MINUTE);
    await current.measurement("after", 99, START + MINUTE + 1);
    await current.measurement("deleted", 99, START);
    await current.baby.deleteActivity("deleted");
    await current.baby.logBottle({ uid: "bottle", volume: 120, startMillis: START });
    const report = await current.insights(START, START + MINUTE);
    expect(report).toMatchObject({ count: 3, volume: 120, temperatures: { count: 2, sum: 74, minimum: 36.6, maximum: 37.4, average: 37 } });
    expect((await current.insights(START, START)).temperatures).toEqual({ count: 1, sum: 36.6, minimum: 36.6, maximum: 36.6, average: 36.6 });
  });

  it("does not treat a custom activity as a temperature measurement merely because it has the field", () => {
    const actions: DailyAction[] = [
      { uid: "custom", userUid: "user", babyUid: "baby", type: "custom_temperature", startMillis: START, temperature: 20 },
      { uid: "real", userUid: "user", babyUid: "baby", type: "temperature", startMillis: START, temperature: 37.4 },
    ];
    const report = buildActivityStatistics(actions);
    expect(report.count).toBe(2);
    expect(report.temperatures).toEqual({ count: 1, sum: 37.4, minimum: 37.4, maximum: 37.4, average: 37.4 });
  });
});
