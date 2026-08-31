import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BabyDaybookClient, buildActivityStatistics, decodeFields, encodeFields } from "../src/index.js";
import type { ActivityStatisticsOptions, DailyAction, FetchLike } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const ORIGINAL_TIME_ZONE = process.env.TZ;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const TRANSITIONS = [
  { zone: "America/Chicago", month: 3, day: 8, shift: 60, noon: "2026-03-08T17:00:00.000Z" },
  { zone: "America/Chicago", month: 11, day: 1, shift: -60, noon: "2026-11-01T18:00:00.000Z" },
  { zone: "America/New_York", month: 3, day: 8, shift: 60, noon: "2026-03-08T16:00:00.000Z" },
  { zone: "America/New_York", month: 11, day: 1, shift: -60, noon: "2026-11-01T17:00:00.000Z" },
  { zone: "Europe/Warsaw", month: 3, day: 29, shift: 60, noon: "2026-03-29T10:00:00.000Z" },
  { zone: "Europe/Warsaw", month: 10, day: 25, shift: -60, noon: "2026-10-25T11:00:00.000Z" },
  { zone: "Australia/Sydney", month: 10, day: 4, shift: 60, noon: "2026-10-04T01:00:00.000Z" },
  { zone: "Australia/Sydney", month: 4, day: 5, shift: -60, noon: "2026-04-05T02:00:00.000Z" },
  { zone: "Australia/Lord_Howe", month: 10, day: 4, shift: 30, noon: "2026-10-04T01:00:00.000Z" },
  { zone: "Australia/Lord_Howe", month: 4, day: 5, shift: -30, noon: "2026-04-05T01:30:00.000Z" },
] as const;
type Transition = typeof TRANSITIONS[number];

function at(transition: Transition, offset: number, hour: number, minute = 0): number {
  return new Date(2026, transition.month - 1, transition.day + offset, hour, minute).getTime();
}

function useTransition(transition: Transition): void {
  process.env.TZ = transition.zone;
  expect(new Date(at(transition, 0, 12)).toISOString()).toBe(transition.noon);
  expect(new Date(at(transition, 0, 0)).getTimezoneOffset() - new Date(at(transition, 1, 0)).getTimezoneOffset()).toBe(transition.shift);
  expect(at(transition, 1, 0) - at(transition, 0, 0)).toBe(24 * HOUR - transition.shift * MINUTE);
}

function sleep(startMillis: number, endMillis: number, extra: Partial<DailyAction> = {}): DailyAction {
  return { uid: "sleep", babyUid: "baby", userUid: "user", type: "sleeping", startMillis, endMillis, ...extra };
}

function fixture() {
  const collection = "babyData/babyUid_baby/dailyActions";
  const records = new Map<string, Record<string, unknown>>([
    ["babyData/babyUid_baby/daTypes/sleeping", { uid: "sleeping", userUid: "user", babyUid: "baby", title: "Sleep", hasDuration: 1 }],
  ]);
  const writes: Array<Record<string, unknown>> = [];
  const wire = (path: string, record: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(record) });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    const path = decodeURIComponent(url.pathname.split("/documents")[1] ?? "");
    if (path === ":commit") {
      expect(init.method).toBe("POST");
      const submitted = JSON.parse(String(init.body)).writes;
      expect(submitted).toHaveLength(1);
      const write = submitted[0];
      const recordPath = write.update.name.split("/documents/")[1];
      expect(recordPath.startsWith(`${collection}/`)).toBe(true);
      const fields = decodeFields(write.update.fields);
      const saved = write.updateMask ? { ...records.get(recordPath) } : {};
      for (const field of write.updateMask?.fieldPaths ?? Object.keys(fields)) {
        if (Object.hasOwn(fields, field)) saved[field] = fields[field];
        else delete saved[field];
      }
      expect(write.updateTransforms).toEqual([{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }]);
      saved.svt = Date.parse("2026-08-31T12:00:00Z");
      records.set(recordPath, saved);
      writes.push(structuredClone(saved));
      return Response.json({ writeResults: [{ updateTime: "2026-08-31T12:00:00.000Z" }] });
    }
    expect(init.method ?? "GET").toBe("GET");
    const recordPath = path.slice(1);
    if (recordPath === collection) return Response.json({ documents: [...records]
      .filter(([stored]) => stored.startsWith(`${collection}/`)).map(([stored, record]) => wire(stored, record)) });
    expect(records.has(recordPath)).toBe(true);
    return Response.json(wire(recordPath, records.get(recordPath)!));
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("baby");
  const connect = vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" }));
  const sdk = createBabyDaybookToolcraftSDK({ env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services: { babyDaybook: { connect } } });
  return { baby, sdk, records, writes };
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  if (ORIGINAL_TIME_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TIME_ZONE;
});

describe.each(TRANSITIONS)("sleep statistics in $zone with $shift minute transition", (transition) => {
  it.each([6, 17])("counts the %s:00 daytime hour as a nap through public and typed APIs", async (hour) => {
    useTransition(transition);
    const current = fixture();
    const startMillis = at(transition, 0, hour);
    const endMillis = at(transition, 0, hour + 1);
    expect(endMillis - startMillis).toBe(HOUR);
    await current.baby.startActivity({ uid: "nap", type: "sleeping", startMillis });
    const stopped = await current.baby.stopActivity("nap", endMillis);
    expect(stopped.duration).toBe(HOUR);
    const snapshot = structuredClone([...current.records]);
    const report = await current.baby.getActivityStatistics();
    expect(report.sleep).toEqual({ count: 1, durationMillis: HOUR, daytimeDurationMillis: HOUR, nightDurationMillis: 0, napCount: 1 });
    expect(report.days[0]).toMatchObject({ daytimeSleepMillis: HOUR, nightSleepMillis: 0, awakeMillis: 11 * HOUR });
    expect(report.byHour[hour]).toBe(1);
    expect((await current.sdk.insights.activities({ babyUid: "baby" })).data).toEqual(report);
    expect([...current.records]).toEqual(snapshot);
    expect(current.writes).toHaveLength(2);
  });

  it("counts actual elapsed sleep through the overnight clock change", () => {
    useTransition(transition);
    const record = sleep(at(transition, -1, 20), at(transition, 0, 6));
    const report = buildActivityStatistics([record]);
    const duration = 10 * HOUR - transition.shift * MINUTE;
    expect(report.sleep).toEqual({ count: 1, durationMillis: duration, daytimeDurationMillis: 0, nightDurationMillis: duration, napCount: 0 });
    expect(report.days).toHaveLength(1);
    expect(report.days[0]?.awakeMillis).toBe(12 * HOUR);
  });

  it("advances multi-day splitting by local dates instead of 24 elapsed hours", () => {
    useTransition(transition);
    const record = sleep(at(transition, -1, 17), at(transition, 1, 7));
    const before = structuredClone(record);
    const report = buildActivityStatistics([record]);
    const duration = 38 * HOUR - transition.shift * MINUTE;
    expect(report.sleep).toEqual({ count: 1, durationMillis: duration, daytimeDurationMillis: 14 * HOUR, nightDurationMillis: duration - 14 * HOUR, napCount: 0 });
    expect(record).toEqual(before);
    expect(report.days).toHaveLength(1);
    expect(report.days[0]?.awakeMillis).toBe(0);
  });

  it("uses elapsed daytime capacity when a custom window spans the transition", () => {
    useTransition(transition);
    const report = buildActivityStatistics([sleep(at(transition, 0, 0), at(transition, 0, 4))], { daytimeStartMinutes: 0, daytimeEndMinutes: 6 * 60 });
    const duration = 4 * HOUR - transition.shift * MINUTE;
    expect(report.sleep).toEqual({ count: 1, durationMillis: duration, daytimeDurationMillis: duration, nightDurationMillis: 0, napCount: 1 });
    expect(report.days[0]?.awakeMillis).toBe(2 * HOUR);
    const noSleep = buildActivityStatistics([sleep(at(transition, 0, 12), at(transition, 0, 12), { type: "bottle" })], { daytimeStartMinutes: 0, daytimeEndMinutes: 6 * 60 });
    expect(noSleep.days[0]?.awakeMillis).toBe(6 * HOUR - transition.shift * MINUTE);
  });

  it("supports a full local day including its shorter or longer actual duration", () => {
    useTransition(transition);
    const record = sleep(at(transition, 0, 0), at(transition, 1, 0));
    const report = buildActivityStatistics([record], { daytimeStartMinutes: 0, daytimeEndMinutes: 1440 });
    const duration = 24 * HOUR - transition.shift * MINUTE;
    expect(report.sleep).toEqual({ count: 1, durationMillis: duration, daytimeDurationMillis: duration, nightDurationMillis: 0, napCount: 1 });
    expect(report.days[0]?.awakeMillis).toBe(0);
  });
});

describe.each(["UTC", "Asia/Kathmandu"])("non-DST controls in %s", (zone) => {
  it.each([[2026, 2, 28], [2028, 2, 29], [2026, 12, 31]])("retains daytime clocks across %s-%s-%s", (year, month, day) => {
    process.env.TZ = zone;
    const start = new Date(year, month - 1, day, 17).getTime();
    const end = new Date(year, month - 1, day + 1, 7).getTime();
    expect(end - start).toBe(14 * HOUR);
    expect(new Date(start).getTimezoneOffset()).toBe(zone === "UTC" ? 0 : -345);
    const report = buildActivityStatistics([sleep(start, end)]);
    expect(report.sleep).toEqual({ count: 1, durationMillis: 14 * HOUR, daytimeDurationMillis: 2 * HOUR, nightDurationMillis: 12 * HOUR, napCount: 0 });
    expect(report.days[0]?.awakeMillis).toBe(10 * HOUR);
  });
});

describe("local daytime boundary semantics", () => {
  it("resets each boundary after a midnight gap instead of carrying 01:00 forward", () => {
    process.env.TZ = "America/Sao_Paulo";
    const midnight = new Date(2018, 10, 4).getTime();
    expect(new Date(midnight).toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(new Date(midnight).getHours()).toBe(1);
    const record = sleep(new Date(2018, 10, 3, 17).getTime(), new Date(2018, 10, 5, 7).getTime());
    const report = buildActivityStatistics([record]);
    expect(report.sleep).toEqual({ count: 1, durationMillis: 37 * HOUR, daytimeDurationMillis: 14 * HOUR, nightDurationMillis: 23 * HOUR, napCount: 0 });
    const morning = buildActivityStatistics([sleep(midnight, new Date(2018, 10, 4, 6).getTime())], { daytimeStartMinutes: 0, daytimeEndMinutes: 360 });
    expect(morning.sleep.daytimeDurationMillis).toBe(5 * HOUR);
    expect(morning.sleep.nightDurationMillis).toBe(0);
    expect(morning.days[0]?.awakeMillis).toBe(0);
  });

  it("accumulates awake time across mixed records without changing order or other metrics", () => {
    useTransition(TRANSITIONS[1]);
    const records = [
      sleep(at(TRANSITIONS[1], 0, 12), at(TRANSITIONS[1], 0, 12), { uid: "bottle", type: "bottle", volume: 120 }),
      sleep(at(TRANSITIONS[1], 0, 0), at(TRANSITIONS[1], 0, 1), { uid: "first" }),
      sleep(at(TRANSITIONS[1], 0, 4), at(TRANSITIONS[1], 0, 5), { uid: "second" }),
    ];
    const options = { daytimeStartMinutes: 0, daytimeEndMinutes: 360 };
    const snapshot = structuredClone(records);
    for (const ordered of [records, [...records].reverse()]) {
      const report = buildActivityStatistics(ordered, options);
      expect(report.days[0]).toMatchObject({ count: 3, volume: 120, daytimeSleepMillis: 2 * HOUR, nightSleepMillis: 0, awakeMillis: 5 * HOUR });
      expect(report.sleep.napCount).toBe(2);
    }
    expect(records).toEqual(snapshot);
  });

  it("passes custom local-clock options through the persisted public statistics path", async () => {
    useTransition(TRANSITIONS[0]);
    const current = fixture();
    const startMillis = at(TRANSITIONS[0], 0, 0);
    await current.baby.startActivity({ uid: "sleep", type: "sleeping", startMillis });
    await current.baby.stopActivity("sleep", at(TRANSITIONS[0], 0, 4));
    const snapshot = structuredClone([...current.records]);
    const report = await current.baby.getActivityStatistics({ fromMillis: startMillis, toMillis: startMillis, daytimeStartMinutes: 0, daytimeEndMinutes: 360 });
    expect(report.sleep.daytimeDurationMillis).toBe(3 * HOUR);
    expect(report.sleep.nightDurationMillis).toBe(0);
    expect(report.days[0]?.awakeMillis).toBe(2 * HOUR);
    expect([...current.records]).toEqual(snapshot);
    expect(current.writes).toHaveLength(2);
  });

  it.each([
    { start: 5 * 60, end: 6 * 60, dayMinutes: 0 },
    { start: 6 * 60, end: 7 * 60, dayMinutes: 60 },
    { start: 17 * 60, end: 18 * 60, dayMinutes: 60 },
    { start: 18 * 60, end: 19 * 60, dayMinutes: 0 },
    { start: 5 * 60 + 30, end: 6 * 60 + 30, dayMinutes: 30 },
    { start: 17 * 60 + 30, end: 18 * 60 + 30, dayMinutes: 30 },
  ])("splits $start–$end at exact local boundaries", ({ start, end, dayMinutes }) => {
    useTransition(TRANSITIONS[0]);
    const record = sleep(at(TRANSITIONS[0], 0, 0, start), at(TRANSITIONS[0], 0, 0, end));
    const report = buildActivityStatistics([record]);
    expect(report.sleep).toEqual({ count: 1, durationMillis: HOUR, daytimeDurationMillis: dayMinutes * MINUTE, nightDurationMillis: (60 - dayMinutes) * MINUTE, napCount: dayMinutes >= 30 ? 1 : 0 });
    expect(report.days[0]?.awakeMillis).toBe(12 * HOUR - dayMinutes * MINUTE);
  });

  it("preserves sub-minute precision and a custom fractional-hour window", () => {
    useTransition(TRANSITIONS[0]);
    const start = at(TRANSITIONS[0], 0, 6, 14) + 59_999;
    const end = at(TRANSITIONS[0], 0, 6, 15) + 1;
    const report = buildActivityStatistics([sleep(start, end)], { daytimeStartMinutes: 375, daytimeEndMinutes: 1065 });
    expect(report.sleep).toEqual({ count: 1, durationMillis: 2, daytimeDurationMillis: 1, nightDurationMillis: 1, napCount: 1 });
    expect(report.days[0]?.awakeMillis).toBe(690 * MINUTE - 1);
  });

  it.each([
    { start: 150, end: 240, dayMinutes: 30 },
    { start: 60, end: 150, dayMinutes: 90 },
    { start: 165, end: 180, dayMinutes: 0 },
  ])("normalizes skipped clock endpoints for $start–$end consistently", ({ start, end, dayMinutes }) => {
    useTransition(TRANSITIONS[0]);
    const options = { daytimeStartMinutes: start, daytimeEndMinutes: end };
    const record = sleep(at(TRANSITIONS[0], 0, 0), at(TRANSITIONS[0], 1, 0));
    const report = buildActivityStatistics([record], options);
    expect(report.sleep.daytimeDurationMillis).toBe(dayMinutes * MINUTE);
    expect(report.sleep.nightDurationMillis).toBe(23 * HOUR - dayMinutes * MINUTE);
    expect(report.days[0]?.awakeMillis).toBe(0);
    expect(buildActivityStatistics([{ ...record, type: "bottle" }], options).days[0]?.awakeMillis).toBe(dayMinutes * MINUTE);
  });

  it("resolves a repeated custom start once, without discarding the repeated hour", () => {
    useTransition(TRANSITIONS[1]);
    const record = sleep(Date.parse("2026-11-01T01:30:00-05:00"), Date.parse("2026-11-01T02:00:00-06:00"));
    const options = { daytimeStartMinutes: 90, daytimeEndMinutes: 120 };
    const report = buildActivityStatistics([record], options);
    expect(report.sleep.daytimeDurationMillis).toBe(90 * MINUTE);
    expect(report.sleep.nightDurationMillis).toBe(0);
    expect(report.days[0]?.awakeMillis).toBe(0);
    expect(buildActivityStatistics([{ ...record, type: "bottle" }], options).days[0]?.awakeMillis).toBe(90 * MINUTE);
  });

  it("retains default duration fallback, zero/reversed intervals, and filter behavior", () => {
    useTransition(TRANSITIONS[0]);
    const start = at(TRANSITIONS[0], 0, 6);
    const { endMillis: omitted, ...durationOnly } = sleep(start, start + HOUR, { duration: HOUR });
    expect(omitted).toBe(start + HOUR);
    const report = buildActivityStatistics([durationOnly, sleep(start, start + HOUR, { deleted: true }), sleep(start - 1, start + HOUR)], { fromMillis: start, toMillis: start });
    expect(report.sleep).toEqual({ count: 1, durationMillis: HOUR, daytimeDurationMillis: HOUR, nightDurationMillis: 0, napCount: 1 });
    for (const end of [start, start - 1]) {
      const empty = buildActivityStatistics([sleep(start, end)]);
      expect(empty.sleep.daytimeDurationMillis).toBe(0);
      expect(empty.sleep.nightDurationMillis).toBe(0);
      expect(empty.days[0]?.awakeMillis).toBe(12 * HOUR);
    }
  });

  it.each([
    { daytimeStartMinutes: -1 },
    { daytimeEndMinutes: 1441 },
    { daytimeStartMinutes: 360.5 },
    { daytimeStartMinutes: 1080, daytimeEndMinutes: 360 },
    { daytimeStartMinutes: 360, daytimeEndMinutes: 360 },
  ])("retains validation for %j", (options: ActivityStatisticsOptions) => {
    expect(() => buildActivityStatistics([], options)).toThrow(RangeError);
  });
});
