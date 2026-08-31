import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BabyDaybookClient, decodeFields, encodeFields, getEarliestReminderDisplayMillis, getRelevantReminderSchedules, resolveReminderSchedule } from "../src/index.js";
import type { FetchLike, Reminder } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const ORIGINAL_TIME_ZONE = process.env.TZ;
const GAPS = [
  { zone: "America/Chicago", year: 2026, month: 3, day: 8, hour: 2, minute: 30, gapIso: "2026-03-08T08:30:12.345Z", nextIso: "2026-03-09T07:30:12.345Z" },
  { zone: "America/New_York", year: 2026, month: 3, day: 8, hour: 2, minute: 30, gapIso: "2026-03-08T07:30:12.345Z", nextIso: "2026-03-09T06:30:12.345Z" },
  { zone: "Europe/Warsaw", year: 2026, month: 3, day: 29, hour: 2, minute: 30, gapIso: "2026-03-29T01:30:12.345Z", nextIso: "2026-03-30T00:30:12.345Z" },
  { zone: "Australia/Sydney", year: 2026, month: 10, day: 4, hour: 2, minute: 30, gapIso: "2026-10-03T16:30:12.345Z", nextIso: "2026-10-04T15:30:12.345Z" },
  { zone: "Australia/Lord_Howe", year: 2026, month: 10, day: 4, hour: 2, minute: 15, gapIso: "2026-10-03T15:45:12.345Z", nextIso: "2026-10-04T15:15:12.345Z" },
] as const;
type Gap = typeof GAPS[number];
const DAY = 86_400_000;
const MINUTE = 60_000;
const SERVER_TIME = Date.parse("2026-08-31T12:00:00.000Z");

function at(gap: Gap, offset: number, hour: number = gap.hour, minute: number = gap.minute): number {
  return new Date(gap.year, gap.month - 1, gap.day + offset, hour, minute, 12, 345).getTime();
}

function useGap(gap: Gap): void {
  process.env.TZ = gap.zone;
  expect(new Date(at(gap, 0)).toISOString()).toBe(gap.gapIso);
  expect(new Date(at(gap, 1)).toISOString()).toBe(gap.nextIso);
  expect(new Date(at(gap, -1)).getTimezoneOffset()).not.toBe(new Date(at(gap, 1)).getTimezoneOffset());
}

function reminder(gap: Gap, values: Partial<Reminder> = {}): Reminder {
  return { uid: "reminder", babyUid: "baby", userUid: "user", type: "advanced_repeat_days", dateMillis: at(gap, -1), repeatDays: 1, ...values };
}

function fixture() {
  const root = "userData/user/babiesReminders/babyUid_baby/reminders";
  const records = new Map<string, Record<string, unknown>>();
  const writes: Array<Record<string, unknown>> = [];
  const wire = (path: string, data: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(data) });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    const path = decodeURIComponent(url.pathname.split("/documents")[1] ?? "");
    if (path === ":commit") {
      expect(init.method).toBe("POST");
      const submitted = JSON.parse(String(init.body)).writes;
      expect(submitted).toHaveLength(1);
      const update = submitted[0].update;
      const recordPath = update.name.split("/documents/")[1];
      expect(recordPath.startsWith(`${root}/`)).toBe(true);
      const fields = decodeFields(update.fields);
      expect(submitted[0].updateTransforms).toEqual([{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }]);
      expect(fields).not.toHaveProperty("svt");
      records.set(recordPath, { ...structuredClone(fields), svt: SERVER_TIME });
      writes.push(structuredClone(fields));
      return Response.json({ writeResults: [{ updateTime: "2026-08-31T12:00:00.000Z" }] });
    }
    expect(init.method ?? "GET").toBe("GET");
    const recordPath = path.slice(1);
    if ([root, "babyData/babyUid_baby/dailyActions", "babyData/babyUid_baby/daTypes"].includes(recordPath)) {
      return Response.json({ documents: [...records].filter(([stored]) => stored.startsWith(`${recordPath}/`)).map(([stored, data]) => wire(stored, data)) });
    }
    expect(records.has(recordPath)).toBe(true);
    return Response.json(wire(recordPath, records.get(recordPath)!));
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("baby");
  const connect = vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" }));
  const sdk = createBabyDaybookToolcraftSDK({ env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services: { babyDaybook: { connect } } });
  return { baby, sdk, records, writes, root };
}

beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  if (ORIGINAL_TIME_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TIME_ZONE;
});

describe.each(GAPS)("recurring reminder clock fidelity in $zone", (gap) => {
  it("keeps the first valid post-gap daily occurrence overdue through public and typed APIs", async () => {
    useGap(gap);
    const current = fixture();
    const saved = await current.baby.createReminder({ uid: "daily", daType: "bottle", type: "advanced_repeat_days", dateMillis: at(gap, -1), repeatDays: 1 }, at(gap, -1, 1));
    await current.baby.dismissReminder(saved.uid, at(gap, 0, 4));
    const now = at(gap, 1) + 10 * MINUTE;
    const snapshot = structuredClone([...current.records]);
    const [schedule] = await current.baby.getReminderSchedules({ nowMillis: now });
    expect(schedule).toMatchObject({ expiredMillis: at(gap, 1), nextMillis: at(gap, 2), reminder: { dateMillis: at(gap, -1), dismissedMillis: at(gap, 0, 4) } });
    expect(await current.baby.getRelevantReminderSchedules({ nowMillis: now })).toEqual([schedule]);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const response = await current.sdk.reminders.list({ babyUid: "baby" });
    expect(response.data).toEqual([schedule]);
    expect([...current.records]).toEqual(snapshot);
    expect(current.writes).toHaveLength(2);
  });

  it.each([-1, 0, 1])("does not revive a dismissed Monday when queried %s days from the gap", async (queryOffset) => {
    useGap(gap);
    const current = fixture();
    const saved = await current.baby.createReminder({ uid: "monday", daType: "bottle", type: "advanced_repeat_weekdays", dateMillis: at(gap, -6), repeatWeekdays: "1" }, at(gap, -6, 1));
    vi.spyOn(Date, "now").mockReturnValue(at(gap, -6) + 15 * MINUTE);
    await current.sdk.reminders.dismiss({ babyUid: "baby", uid: saved.uid });
    const stored = current.records.get(`${current.root}/monday`)!;
    expect(stored).toMatchObject({ dismissedMillis: at(gap, -6) + 15 * MINUTE, updatedMillis: at(gap, -6) + 15 * MINUTE, svt: SERVER_TIME, dateMillis: at(gap, -6) });
    const now = at(gap, queryOffset, 0);
    const snapshot = structuredClone([...current.records]);
    const [schedule] = await current.baby.getReminderSchedules({ nowMillis: now });
    expect(schedule?.nextMillis).toBe(at(gap, 1));
    expect(schedule?.expiredMillis).toBeUndefined();
    expect(await current.baby.getRelevantReminderSchedules({ nowMillis: now })).toEqual([]);
    expect([...current.records]).toEqual(snapshot);
    expect(current.writes).toHaveLength(2);
  });

  it.each([1, 2, 3, 7, 30])("preserves the %s-day interval and its original seconds across the gap", (repeatDays) => {
    useGap(gap);
    const saved = reminder(gap, { dateMillis: at(gap, -repeatDays), repeatDays });
    const snapshot = structuredClone(saved);
    const afterGap = resolveReminderSchedule(saved, { nowMillis: at(gap, 0, 4) });
    expect(afterGap.expiredMillis).toBe(at(gap, 0));
    expect(afterGap.nextMillis).toBe(at(gap, repeatDays));
    const afterNext = resolveReminderSchedule(saved, { nowMillis: at(gap, repeatDays) + 1 });
    expect(afterNext.expiredMillis).toBe(at(gap, repeatDays));
    expect(afterNext.nextMillis).toBe(at(gap, 2 * repeatDays));
    expect(saved).toEqual(snapshot);
  });

  it("normalizes only the missing occurrence, with strict due and relevance boundaries", () => {
    useGap(gap);
    const saved = reminder(gap, { dismissedMillis: at(gap, -1) + 1 });
    const occurrence = at(gap, 0);
    const before = resolveReminderSchedule(saved, { nowMillis: occurrence - 1 });
    expect(before.nextMillis).toBe(occurrence);
    expect(before.expiredMillis).toBeUndefined();
    const exact = resolveReminderSchedule(saved, { nowMillis: occurrence });
    expect(exact.nextMillis).toBe(at(gap, 1));
    expect(exact.expiredMillis).toBeUndefined();
    const after = resolveReminderSchedule(saved, { nowMillis: occurrence + 1 });
    expect(after.nextMillis).toBe(at(gap, 1));
    expect(after.expiredMillis).toBe(occurrence);
    const dismissed = { ...saved, dismissedMillis: occurrence + 1 };
    const lead = at(gap, 1) - 30 * MINUTE;
    const upcoming = resolveReminderSchedule(dismissed, { nowMillis: lead });
    expect(getRelevantReminderSchedules([upcoming], lead)).toEqual([]);
    expect(getRelevantReminderSchedules([upcoming], lead + 1)).toEqual([upcoming]);
    expect(getEarliestReminderDisplayMillis([upcoming], lead)).toBe(lead);
  });

  it("reconstructs past weekday occurrences without moving their clock", () => {
    useGap(gap);
    const saved = reminder(gap, { type: "advanced_repeat_weekdays", repeatWeekdays: "1,3,5", dateMillis: at(gap, -6) });
    const result = resolveReminderSchedule(saved, { nowMillis: at(gap, 1, 0) });
    expect(result.expiredMillis).toBe(at(gap, -2));
    expect(result.nextMillis).toBe(at(gap, 1));
  });

  it("normalizes a selected Sunday occurrence without shifting the following Sunday", () => {
    useGap(gap);
    const saved = reminder(gap, { type: "advanced_repeat_weekdays", repeatWeekdays: "0", dateMillis: at(gap, -7), dismissedMillis: at(gap, -7) + 1 });
    const occurrence = at(gap, 0);
    expect(resolveReminderSchedule(saved, { nowMillis: occurrence - 1 }).nextMillis).toBe(occurrence);
    const after = resolveReminderSchedule(saved, { nowMillis: occurrence + 1 });
    expect(after.expiredMillis).toBe(occurrence);
    expect(after.nextMillis).toBe(at(gap, 7));
  });

  it("retains activity satisfaction and DND annotations for the corrected occurrence", () => {
    useGap(gap);
    const saved = reminder(gap, { dndFrom: "02:00", dndTo: "03:00" });
    const now = at(gap, 1) + 10 * MINUTE;
    const result = resolveReminderSchedule(saved, { nowMillis: now });
    expect(result.expiredMillis).toBe(at(gap, 1));
    expect(result.expiredIsInDnd).toBe(true);
    expect(result.nextIsInDnd).toBe(true);
    const satisfied = resolveReminderSchedule(saved, { nowMillis: now, lastActivity: { uid: "feed", babyUid: "baby", userUid: "user", type: "bottle", startMillis: at(gap, 1) + 1 } });
    expect(satisfied.expiredMillis).toBeUndefined();
    expect(satisfied.nextMillis).toBe(at(gap, 2));
  });
});

describe("recurrence controls", () => {
  it.each([
    { zone: "America/Chicago", anchor: "2026-10-31T01:30:12.345-05:00", first: "2026-11-01T01:30:12.345-05:00", second: "2026-11-01T01:30:12.345-06:00", next: "2026-11-02T01:30:12.345-06:00" },
    { zone: "Australia/Lord_Howe", anchor: "2026-04-04T01:45:12.345+11:00", first: "2026-04-05T01:45:12.345+11:00", second: "2026-04-05T01:45:12.345+10:30", next: "2026-04-06T01:45:12.345+10:30" },
  ])("uses the earlier offset once on a repeated clock in $zone", ({ zone, anchor, first, second, next }) => {
    process.env.TZ = zone;
    expect(new Date(first).getHours()).toBe(new Date(second).getHours());
    expect(new Date(first).getTimezoneOffset()).not.toBe(new Date(second).getTimezoneOffset());
    for (const type of ["advanced_repeat_days", "advanced_repeat_weekdays"] as const) {
      const saved = { ...reminder(GAPS[0]), type, dateMillis: Date.parse(anchor), repeatWeekdays: "0,1,2,3,4,5,6" };
      expect(resolveReminderSchedule(saved, { nowMillis: Date.parse(first) - 1 }).nextMillis).toBe(Date.parse(first));
      const after = resolveReminderSchedule(saved, { nowMillis: Date.parse(second) + 1 });
      expect(after.expiredMillis).toBe(Date.parse(first));
      expect(after.nextMillis).toBe(Date.parse(next));
      expect(resolveReminderSchedule({ ...saved, dismissedMillis: Date.parse(first) + 1 }, { nowMillis: Date.parse(second) + 1 }).expiredMillis).toBeUndefined();
    }
  });

  it.each(["UTC", "Asia/Kathmandu"])("preserves non-DST clocks and month/year boundaries in %s", (zone) => {
    process.env.TZ = zone;
    for (const date of [[2026, 0, 1], [2026, 2, 1], [2028, 2, 1]]) {
      const [year, month, day] = date as [number, number, number];
      const anchor = new Date(year, month, day - 7, 2, 30, 12, 345).getTime();
      const today = new Date(year, month, day, 2, 30, 12, 345).getTime();
      const saved = reminder(GAPS[0], { dateMillis: anchor, repeatDays: 7 });
      const result = resolveReminderSchedule(saved, { nowMillis: today + 1 });
      expect(result.expiredMillis).toBe(today);
      expect(result.nextMillis).toBe(new Date(year, month, day + 7, 2, 30, 12, 345).getTime());
    }
  });

  it("keeps one-time and elapsed activity-relative reminders unchanged", () => {
    const gap = GAPS[0];
    useGap(gap);
    const fixed = reminder(gap, { type: "advanced", dateMillis: at(gap, 0) });
    expect(resolveReminderSchedule(fixed, { nowMillis: at(gap, 0, 1) }).nextMillis).toBe(at(gap, 0));
    const basic = reminder(gap, { type: "basic", intervalMillis: 3 * 60 * MINUTE });
    const start = at(gap, 0, 1);
    expect(resolveReminderSchedule(basic, { nowMillis: start + 1, lastActivity: { uid: "feed", userUid: "user", babyUid: "baby", type: "bottle", startMillis: start } }).nextMillis).toBe(start + 3 * 60 * MINUTE);
    expect(resolveReminderSchedule({ ...fixed, deleted: true }, { nowMillis: at(gap, 0, 1) }).nextMillis).toBeUndefined();
  });

  it("uses the stored normalized clock when the anchor itself was created inside a gap", () => {
    const gap = GAPS[0];
    useGap(gap);
    const saved = reminder(gap, { dateMillis: at(gap, 0) });
    expect(new Date(saved.dateMillis).getHours()).toBe(3);
    const result = resolveReminderSchedule(saved, { nowMillis: at(gap, 1, 4) });
    expect(result.expiredMillis).toBe(at(gap, 1, 3));
    expect(result.nextMillis).toBe(at(gap, 2, 3));
  });

  it("jumps long date ranges without walking every intervening day", () => {
    const gap = GAPS[0];
    useGap(gap);
    const saved = reminder(gap, { dateMillis: at(gap, -10000), repeatDays: 7 });
    const setDate = vi.spyOn(Date.prototype, "setDate");
    const setFullYear = vi.spyOn(Date.prototype, "setFullYear");
    const now = at(gap, 1, 12);
    const expectedOffset = -10000 + Math.floor(10001 / 7) * 7;
    const result = resolveReminderSchedule(saved, { nowMillis: now });
    expect(result.expiredMillis).toBe(at(gap, expectedOffset));
    expect(result.nextMillis).toBe(at(gap, expectedOffset + 7));
    expect(result.nextMillis! - result.expiredMillis!).toBeLessThanOrEqual(7 * DAY + 60 * MINUTE);
    expect(setDate.mock.calls.length + setFullYear.mock.calls.length).toBeLessThan(20);
  });
});
