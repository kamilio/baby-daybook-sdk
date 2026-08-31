import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activitiesToPdf, BabyDaybookClient, decodeFields, encodeFields } from "../src/index.js";
import type { ActivityPdfOptions, DailyAction, FetchLike } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const START = Date.parse("2026-08-31T12:00:00Z");
const ROOT = "babyData/babyUid_baby";
const VOLUME_TYPES = ["bottle", "pump", "drink"] as const;
const OPTIONS = { generatedAt: START, timeZone: "UTC", includeDayTimeline: false, includeDaySummaries: false };

function action(type: string, values: Partial<DailyAction> = {}): DailyAction {
  return { uid: type, userUid: "user", babyUid: "baby", type, startMillis: START, ...values };
}

function row(bytes: Uint8Array, timestamp = "2026-08-31 12:00"): string {
  const text = new TextDecoder().decode(bytes);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const xref = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  const found = text.split("\n").find((line) => line.startsWith(`(${timestamp}`));
  expect(found).toBeDefined();
  return found!.slice(1, -4);
}

function quantity(bytes: Uint8Array): string {
  return row(bytes).slice(52, 64).trim();
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>([[ROOT, { uid: "baby", name: "Synthetic volume fixture" }]]);
  const writes: Array<Record<string, unknown>> = [];
  for (const type of VOLUME_TYPES) records.set(`${ROOT}/daTypes/${type}`, {
    uid: type, userUid: "user", babyUid: "baby", title: type, hasDuration: 0,
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

describe("activity PDF volume values", () => {
  it.each(VOLUME_TYPES)("exports a publicly logged %s volume through native storage and typed reports", async (type) => {
    const current = fixture();
    const input = { uid: "sample", startMillis: START, volume: 123, notes: "Afternoon feed" };
    const logged = type === "bottle" ? await current.baby.logBottle(input)
      : type === "pump" ? await current.baby.logPump({ ...input, side: "left" })
        : await current.baby.logActivity({ ...input, type });
    expect(logged).toMatchObject({ volume: 123, amount: 0 });
    expect(current.records.get(`${ROOT}/dailyActions/sample`)).toMatchObject({ volume: 123, amount: 0 });
    const before = structuredClone([...current.records]);
    const [header = [], values = []] = (await current.baby.exportActivitiesCsv()).trim().split("\n").map((line) => line.split(","));
    expect(values[header.indexOf("volume")]).toBe("123");
    expect(values[header.indexOf("amount")]).toBe("0");
    const pdf = await current.baby.exportActivitiesPdf(OPTIONS);
    expect(quantity(pdf)).toBe("123 ml");
    expect(row(pdf)).toContain("Afternoon feed");
    const response = await current.sdk.reports.activitiesPdf({ babyUid: "baby", timeZone: "UTC" });
    expect(current.connect).toHaveBeenCalledTimes(1);
    const report = response.data as unknown as { dataBase64: string };
    expect(quantity(Buffer.from(report.dataBase64, "base64"))).toBe("123 ml");
    expect([...current.records]).toEqual(before);
    expect(current.writes).toHaveLength(1);
  });

  it.each(VOLUME_TYPES.flatMap((type) => [0, 123, 123.5, 5000].map((volume) => ({ type, volume }))))(
    "uses $volume ml for $type even when another amount is present", ({ type, volume }) => {
      expect(quantity(activitiesToPdf([action(type, { volume, amount: 9, amountUnit: "oz" })], OPTIONS))).toBe(`${volume} ml`);
    },
  );

  it.each(VOLUME_TYPES)("leaves a missing %s volume blank instead of inventing an amount", (type) => {
    expect(quantity(activitiesToPdf([action(type, { amount: 4, amountUnit: "oz" })], OPTIONS))).toBe("");
  });

  it.each([
    { type: "medicine", amount: 2.5, amountUnit: "ml" },
    { type: "food", amount: 42, amountUnit: "g" },
    { type: "other", amount: 0, amountUnit: "count" },
    { type: "custom", amount: 3, amountUnit: "servings" },
    { type: "custom", amount: 7, amountUnit: "" },
  ])("retains $type amounts and their units", ({ type, amount, amountUnit }) => {
    expect(quantity(activitiesToPdf([action(type, { volume: 0, amount, amountUnit })], OPTIONS)))
      .toBe(`${amount}${amountUnit ? ` ${amountUnit}` : ""}`);
  });

  it("does not infer a quantity from unrelated native volume defaults", () => {
    expect(quantity(activitiesToPdf([action("sleep", { volume: 0 })], OPTIONS))).toBe("");
    expect(quantity(activitiesToPdf([action("custom")], OPTIONS))).toBe("");
  });

  it("selects the stored quantity independently of an activity's display title", () => {
    const activityTypes = [
      { uid: "bottle", userUid: "user", babyUid: "baby", title: "Milk" },
      { uid: "custom", userUid: "user", babyUid: "baby", title: "Bottle" },
    ];
    const options: ActivityPdfOptions = { ...OPTIONS, activityTypes };
    const bottle = activitiesToPdf([action("bottle", { volume: 123, amount: 0 })], options);
    expect(row(bottle)).toContain("Milk");
    expect(quantity(bottle)).toBe("123 ml");
    expect(quantity(activitiesToPdf([action("custom", { volume: 123, amount: 3, amountUnit: "g" })], options))).toBe("3 g");
  });

  it("preserves pumping duration alongside its volume", () => {
    const pdf = activitiesToPdf([action("pump", { endMillis: START + 900_000, volume: 123, amount: 0 })], OPTIONS);
    expect(row(pdf).slice(41, 51).trim()).toBe("15m");
    expect(quantity(pdf)).toBe("123 ml");
  });

  it("keeps date and deleted-record filtering without changing source records", () => {
    const records = [
      action("bottle", { volume: 123, amount: 0 }),
      action("pump", { uid: "deleted", volume: 456, amount: 0, deleted: true }),
      action("drink", { volume: 789, amount: 0, startMillis: START - 86_400_000 }),
    ];
    const before = structuredClone(records);
    const options = { ...OPTIONS, fromMillis: START, toMillis: START };
    const pdf = activitiesToPdf(records, options);
    expect(quantity(pdf)).toBe("123 ml");
    expect(new TextDecoder().decode(pdf)).not.toMatch(/456 ml|789 ml/);
    expect(new TextDecoder().decode(activitiesToPdf(records, { ...options, includeDeleted: true }))).toContain("456 ml");
    expect(records).toEqual(before);
  });
});
