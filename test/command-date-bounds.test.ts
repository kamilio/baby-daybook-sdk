import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import { createMCPServer } from "toolcraft/mcp";
import { BabyDaybookClient, countActivitiesForRange, encodeFields, getStatisticsPredefinedDateRange, listActivitiesForRange } from "../src/index.js";
import type { DailyAction, FetchLike, StatisticsTimeInterval } from "../src/index.js";
import { babyDaybookCommands, createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const ORIGINAL_TIME_ZONE = process.env.TZ;
const ORIGINAL_EXIT_CODE = process.exitCode;
const NOW = Date.UTC(2026, 7, 26, 18);
const BOUNDARY = Date.UTC(2026, 7, 25, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BOUNDS = ["fromMillis", "toMillis"] as const;
const PRESETS = ["last7Days", "last14Days", "last30Days", "thisMonth", "lastMonth", "sinceBirthday"] as const;

function activity(uid: string, startMillis: number, extra: Partial<DailyAction> = {}): DailyAction {
  return { uid, userUid: "user", babyUid: "baby", type: "bottle", startMillis, ...extra };
}

function fixture(type = "bottle", boundary = BOUNDARY, birthdayMillis: number | undefined = Date.UTC(2026, 7, 1)) {
  const records: DailyAction[] = [-1, 0, 1].map((offset) => activity(["before", "boundary", "after"][offset + 1]!, boundary + offset * DAY, { type, ...(type === "sleeping" ? { endMillis: boundary + offset * DAY + HOUR, duration: HOUR, inProgress: false } : {}) }));
  const requests: string[] = [];
  const profile: Record<string, unknown> = { uid: "baby", userUid: "user", name: "Fixture Baby" };
  if (birthdayMillis !== undefined) profile.birthdayMillis = birthdayMillis;
  const types = [{ uid: "sleeping", userUid: "user", babyUid: "baby", title: "Sleep", hasDuration: 1 }];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    expect(init.method ?? "GET").toBe("GET");
    const path = decodeURIComponent(url.pathname.split("/documents/")[1]!);
    requests.push(path);
    const name = url.pathname.slice(4);
    if (path === "babyData/babyUid_baby") return Response.json({ name, fields: encodeFields(profile) });
    expect(["babyData/babyUid_baby/dailyActions", "babyData/babyUid_baby/daTypes"]).toContain(path);
    const values = path.endsWith("/dailyActions") ? records : types;
    return Response.json({ documents: values.map((record) => ({ name: `${name}/${record.uid}`, fields: encodeFields(record as unknown as Record<string, unknown>) })) });
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("baby");
  const services = { babyDaybook: { connect: vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" })) } };
  const sdk = createBabyDaybookToolcraftSDK({ services, env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" } });
  return { baby, sdk, services, records, requests, profile };
}

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  process.exitCode = ORIGINAL_EXIT_CODE;
  if (ORIGINAL_TIME_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TIME_ZONE;
});

describe("independent timeline bounds", () => {
  it.each(BOUNDS)("honors a lone %s in the original three-record scenario", async (bound) => {
    const current = fixture();
    const snapshot = structuredClone(current.records);
    const options = { [bound]: BOUNDARY };
    const result = await current.sdk.timeline.list({ babyUid: "baby", ...options });
    const expected = bound === "fromMillis" ? ["after", "boundary"] : ["boundary", "before"];
    expect((result.data as unknown as DailyAction[]).map(({ uid }) => uid)).toEqual(expected);
    expect(await current.baby.listActivitiesForRange(options)).toEqual(result.data);
    expect(countActivitiesForRange(current.records, ["sleeping"], options)).toBe(2);
    expect(current.records).toEqual(snapshot);
    expect(current.requests.filter((path) => path.endsWith("/daTypes"))).toHaveLength(2);
  });

  it.each(BOUNDS)("treats a zero %s as an explicit bound", async (bound) => {
    const current = fixture("bottle", 0);
    const result = await current.sdk.timeline.list({ babyUid: "baby", [bound]: 0 });
    expect((result.data as unknown as DailyAction[]).map(({ uid }) => uid)).toEqual(bound === "fromMillis" ? ["after", "boundary"] : ["boundary", "before"]);
  });

  it("keeps overlap semantics for a lower bound rather than switching to start-only search", async () => {
    const current = fixture();
    current.records.splice(0, current.records.length,
      activity("ended-at-bound", BOUNDARY - HOUR, { type: "sleeping", endMillis: BOUNDARY }),
      activity("overlap", BOUNDARY - HOUR, { type: "sleeping", endMillis: BOUNDARY + 1 }),
      activity("active", BOUNDARY - 2 * HOUR, { type: "sleeping", inProgress: true }),
      activity("instant-before", BOUNDARY - HOUR, { endMillis: BOUNDARY + HOUR }),
      activity("future", NOW + DAY),
    );
    const result = await current.sdk.timeline.list({ babyUid: "baby", fromMillis: BOUNDARY });
    expect((result.data as unknown as DailyAction[]).map(({ uid }) => uid)).toEqual(["future", "overlap", "active"]);
    expect(await current.baby.listActivitiesForRange({ fromMillis: BOUNDARY, toMillis: NOW + DAY })).toEqual(result.data);
  });

  it("keeps an upper-only range open to earlier starts and excludes later starts", async () => {
    const current = fixture("sleeping");
    current.records[0]!.endMillis = BOUNDARY + DAY;
    expect((await current.sdk.timeline.list({ babyUid: "baby", toMillis: BOUNDARY })).data).toEqual(await current.baby.listActivitiesForRange({ fromMillis: BOUNDARY - 10 * DAY, toMillis: BOUNDARY }));
  });

  it.each(BOUNDS)("preserves includeDeleted with a lone %s", async (bound) => {
    const current = fixture();
    current.records[1]!.deleted = true;
    expect((await current.sdk.timeline.list({ babyUid: "baby", [bound]: BOUNDARY })).data).toHaveLength(1);
    expect((await current.sdk.timeline.list({ babyUid: "baby", [bound]: BOUNDARY, includeDeleted: true })).data).toHaveLength(2);
    expect(current.records[1]!.deleted).toBe(true);
  });

  it("retains no-bound repository order and both-bound inclusivity", async () => {
    const current = fixture();
    expect((await current.sdk.timeline.list({ babyUid: "baby" })).data).toHaveLength(3);
    expect(current.requests).toEqual(["babyData/babyUid_baby/dailyActions"]);
    const atBoundary = await current.sdk.timeline.list({ babyUid: "baby", fromMillis: BOUNDARY, toMillis: BOUNDARY });
    expect((atBoundary.data as unknown as DailyAction[]).map(({ uid }) => uid)).toEqual(["boundary"]);
    expect(listActivitiesForRange(current.records, [], {}).map(({ uid }) => uid)).toEqual(["after", "boundary", "before"]);
  });

  it.each(BOUNDS)("returns no matches rather than all history for an empty %s window", async (bound) => {
    const current = fixture();
    const value = BOUNDARY + (bound === "fromMillis" ? 10 : -10) * DAY;
    expect((await current.sdk.timeline.list({ babyUid: "baby", [bound]: value })).data).toEqual([]);
    current.records.length = 0;
    expect((await current.sdk.timeline.list({ babyUid: "baby", [bound]: BOUNDARY })).data).toEqual([]);
  });

  it.each([
    { fromMillis: Number.NaN }, { toMillis: Number.NaN },
    { fromMillis: Number.POSITIVE_INFINITY }, { toMillis: Number.NEGATIVE_INFINITY },
    { fromMillis: 2, toMillis: 1 }, { nowMillis: Number.NaN },
  ])("retains validation for optional range %j", (options) => {
    expect(() => listActivitiesForRange([], [], options)).toThrow(RangeError);
  });
});

describe.each(PRESETS)("partial sleep bounds with %s", (interval: StatisticsTimeInterval) => {
  it.each(BOUNDS)("overrides only %s and takes the other endpoint from the preset", async (bound) => {
    const boundary = interval === "lastMonth" ? Date.UTC(2026, 6, 15, 12) : BOUNDARY;
    const current = fixture("sleeping", boundary);
    const snapshot = structuredClone(current.records);
    const defaultRange = getStatisticsPredefinedDateRange(interval, Date.UTC(2026, 7, 1), NOW);
    const explicitRange = { ...defaultRange, [bound]: boundary };
    const options = { daytimeStartMinutes: 9 * 60, daytimeEndMinutes: 21 * 60 };
    const result = await current.sdk.sleep.statistics({ babyUid: "baby", interval, [bound]: boundary, ...options });
    expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
    expect(result.data).toEqual(await current.baby.getStatisticsSleepDurationData(explicitRange, options));
    expect(await current.sdk.sleep.statistics({ babyUid: "baby", ...explicitRange, ...options })).toEqual(result);
    expect(current.records).toEqual(snapshot);
    expect(current.requests.filter((path) => path === "babyData/babyUid_baby")).toHaveLength(1);
  });
});

describe("sleep bound precedence and controls", () => {
  it.each(BOUNDS)("corrects the original default-preset %s case", async (bound) => {
    const current = fixture("sleeping");
    const defaultRange = getStatisticsPredefinedDateRange("last7Days", undefined, NOW);
    const result = await current.sdk.sleep.statistics({ babyUid: "baby", [bound]: BOUNDARY });
    expect(result.data).toEqual(await current.baby.getStatisticsSleepDurationData({ ...defaultRange, [bound]: BOUNDARY }));
    expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
  });

  it.each(BOUNDS)("accepts zero as a supplied sleep %s", async (bound) => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(1970, 0, 3, 18));
    const current = fixture("sleeping", 0);
    delete current.profile.birthdayMillis;
    expect((await current.sdk.sleep.statistics({ babyUid: "baby", [bound]: 0 })).data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
  });

  it.each(BOUNDS)("uses ordinary fallback endpoints without requiring a birthday for %s", async (bound) => {
    const current = fixture("sleeping");
    delete current.profile.birthdayMillis;
    const result = await current.sdk.sleep.statistics({ babyUid: "baby", [bound]: BOUNDARY });
    expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
    expect(current.profile).not.toHaveProperty("birthdayMillis");
  });

  it("retains no-bound defaults and complete explicit-range precedence over the preset", async () => {
    const current = fixture("sleeping");
    delete current.profile.birthdayMillis;
    expect((await current.sdk.sleep.statistics({ babyUid: "baby" })).data).toMatchObject({ total: { totalDurationMillis: { value: 3 * HOUR } } });
    current.requests.length = 0;
    const result = await current.sdk.sleep.statistics({ babyUid: "baby", fromMillis: BOUNDARY, toMillis: BOUNDARY, interval: "sinceBirthday" });
    expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: HOUR } } });
    expect(current.requests).toEqual(["babyData/babyUid_baby/dailyActions"]);
  });

  it.each([{ fromMillis: NOW + 2 * DAY }, { toMillis: NOW - 90 * DAY }])("rejects an inverted combined range for %j rather than ignoring it", async (options) => {
    const current = fixture("sleeping");
    await expect(current.sdk.sleep.statistics({ babyUid: "baby", ...options })).rejects.toThrow("range start must not be after its end");
  });

  it("keeps sinceBirthday requirements when a missing endpoint needs that preset", async () => {
    const current = fixture("sleeping");
    delete current.profile.birthdayMillis;
    await expect(current.sdk.sleep.statistics({ babyUid: "baby", toMillis: BOUNDARY, interval: "sinceBirthday" })).rejects.toThrow("does not have a birthday");
  });
});

describe.each(["timeline", "sleep"] as const)("%s command adapters", (command) => {
  it.each(BOUNDS)("honors %s through CLI argument parsing", async (bound) => {
    const current = fixture(command === "sleep" ? "sleeping" : "bottle");
    const output: string[] = [];
    await runCLI(babyDaybookCommands, { argv: ["node", "baby-daybook", command, command === "sleep" ? "statistics" : "list", "baby", bound === "fromMillis" ? "--from-millis" : "--to-millis", String(BOUNDARY), "--output", "json"], services: current.services, controls: { output: true }, outputEmitter: (entry) => { output.push(entry); }, errorReports: false });
    const result = JSON.parse(output.join("\n"));
    if (command === "sleep") expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
    else expect(result.data.map((record: DailyAction) => record.uid)).toEqual(bound === "fromMillis" ? ["after", "boundary"] : ["boundary", "before"]);
  });

  it.each(BOUNDS)("honors %s through MCP tools/call", async (bound) => {
    const current = fixture(command === "sleep" ? "sleeping" : "bottle");
    const server = createMCPServer(babyDaybookCommands, { name: "range-fixture", version: "0.1.0", omitRootToolNamePrefix: true, services: current.services });
    const session = server.createMessageSession(() => undefined);
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1.0.0" } });
      const response = await session.handleMessage("tools/call", { name: command === "sleep" ? "sleep__statistics" : "timeline__list", arguments: { baby_uid: "baby", [bound === "fromMillis" ? "from_millis" : "to_millis"]: BOUNDARY } }) as { result: { structuredContent: { data: unknown }; isError?: boolean } };
      expect(response.result.isError).not.toBe(true);
      const data = response.result.structuredContent.data;
      if (command === "sleep") expect(data).toMatchObject({ total: { totalDurationMillis: { value: 2 * HOUR } } });
      else expect((data as DailyAction[]).map(({ uid }) => uid)).toEqual(bound === "fromMillis" ? ["after", "boundary"] : ["boundary", "before"]);
    } finally { session.close(); }
  });
});
