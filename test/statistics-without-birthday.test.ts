import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import { createMCPServer } from "toolcraft/mcp";
import { BabyDaybookClient, buildStatisticsDateRangeNavigation, canLoadPreviousStatisticsDateRange, decodeFields, encodeFields, getPreviousStatisticsDateRange, getStatisticsPredefinedDateRange } from "../src/index.js";
import type { FetchLike, StatisticsDateRange } from "../src/index.js";
import { babyDaybookCommands, createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const ORIGINAL_TIME_ZONE = process.env.TZ;
const NOW = Date.parse("2026-08-26T18:00:00Z");
const HOUR = 3_600_000;
const PROFILE = "babyData/babyUid_birthdayless";
const PRESETS = ["last7Days", "last14Days", "last30Days", "thisMonth", "lastMonth"] as const;

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const commits: number[] = [];
  const reads: string[] = [];
  const wire = (path: string, data: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(data) });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    if ((init.method ?? "GET") === "GET") {
      const path = decodeURIComponent(url.pathname.split("/documents/")[1]!);
      expect(path.startsWith(PROFILE)).toBe(true);
      reads.push(path);
      const record = records.get(path);
      if (record) return Response.json(wire(path, record));
      if (path === PROFILE) return Response.json({ error: { message: "Missing fixture profile", status: "NOT_FOUND" } }, { status: 404 });
      expect(path).toBe(`${PROFILE}/dailyActions`);
      return Response.json({ documents: [...records].filter(([stored]) => stored.startsWith(`${path}/`)).map(([stored, data]) => wire(stored, data)) });
    }
    expect(init.method).toBe("POST");
    expect(url.pathname.endsWith("/documents:commit")).toBe(true);
    const writes = JSON.parse(String(init.body)).writes;
    commits.push(writes.length);
    for (const write of writes) {
      const path = write.update.name.split("/documents/")[1];
      expect(path.startsWith(PROFILE)).toBe(true);
      const fields = decodeFields(write.update.fields);
      const saved = write.updateMask ? { ...records.get(path) } : {};
      for (const field of write.updateMask?.fieldPaths ?? Object.keys(fields)) {
        if (Object.hasOwn(fields, field)) saved[field] = fields[field];
        else delete saved[field];
      }
      expect(write.updateTransforms).toEqual([{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }]);
      saved.svt = NOW;
      records.set(path, saved);
    }
    return Response.json({ writeResults: writes.map(() => ({ updateTime: new Date(NOW).toISOString() })) });
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("birthdayless");
  const services = { babyDaybook: { connect: vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" })) } };
  const sdk = createBabyDaybookToolcraftSDK({ services, env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" } });
  const create = async (extra: Record<string, number> = {}) => {
    const created = await client.createBaby({ uid: "birthdayless", name: "Fixture Baby", ...extra });
    expect(commits).toEqual([1, 59]);
    return created;
  };
  const nap = async (startMillis: number) => {
    await baby.startActivity({ uid: "sleep", type: "sleeping", startMillis });
    expect((await baby.stopActivity("sleep", startMillis + HOUR)).duration).toBe(HOUR);
  };
  return { client, baby, sdk, services, records, commits, reads, create, nap };
}

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  if (ORIGINAL_TIME_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TIME_ZONE;
});

describe.each(["UTC", "America/Chicago"])("birthday-free statistics in %s", (zone) => {
  it.each(PRESETS)("supports %s after public profile creation and sleep logging", async (interval) => {
    process.env.TZ = zone;
    const current = fixture();
    expect((await current.create()).birthdayMillis).toBeUndefined();
    const startMillis = new Date(2026, interval === "lastMonth" ? 6 : 7, interval === "lastMonth" ? 15 : 26, 12).getTime();
    await current.nap(startMillis);
    const snapshot = structuredClone([...current.records]);
    const commits = [...current.commits];
    const expected = getStatisticsPredefinedDateRange(interval, undefined, NOW);
    expect(await current.baby.getStatisticsDateRange(interval, NOW)).toEqual({ range: expected, canLoadPrevious: true, canLoadNext: interval === "lastMonth" });
    const explicit = await current.sdk.sleep.statistics({ babyUid: "birthdayless", ...expected });
    expect(explicit.data).toMatchObject({ total: { totalDurationMillis: { value: HOUR } } });
    expect(await current.sdk.sleep.statistics({ babyUid: "birthdayless", interval })).toEqual(explicit);
    if (interval === "last7Days") expect(await current.sdk.sleep.statistics({ babyUid: "birthdayless" })).toEqual(explicit);
    expect([...current.records]).toEqual(snapshot);
    expect(current.commits).toEqual(commits);
    expect(current.records.get(PROFILE)).not.toHaveProperty("birthdayMillis");
    expect(current.reads.filter((path) => path === `${PROFILE}/dailyActions`)).toHaveLength(interval === "last7Days" ? 3 : 2);
  });
});

describe("unknown birthday navigation policy", () => {
  it.each(PRESETS)("allows previous %s pages without inventing a birthday", (interval) => {
    const range = getStatisticsPredefinedDateRange(interval, undefined, NOW);
    const before = { ...range };
    expect(canLoadPreviousStatisticsDateRange(range)).toBe(true);
    expect(buildStatisticsDateRangeNavigation(range, undefined, NOW)).toEqual({ range, canLoadPrevious: true, canLoadNext: interval === "lastMonth" });
    const previous = getPreviousStatisticsDateRange(range);
    expect(buildStatisticsDateRangeNavigation(previous, undefined, NOW)).toEqual({ range: previous, canLoadPrevious: true, canLoadNext: true });
    expect(range).toEqual(before);
  });

  it("does not substitute the Unix epoch as an unknown lower bound", () => {
    const range = { fromMillis: Date.UTC(1969, 10, 1), toMillis: Date.UTC(1969, 11, 1) - 1 };
    expect(canLoadPreviousStatisticsDateRange(range)).toBe(true);
    expect(canLoadPreviousStatisticsDateRange(range, 0)).toBe(false);
    expect(canLoadPreviousStatisticsDateRange(undefined)).toBe(false);
  });

  it.each([undefined, Date.UTC(2026, 7, 1), 0, Date.UTC(2026, 8, 1)])("preserves ordinary range dates with birthday %s", async (birthdayMillis) => {
    const current = fixture();
    await current.create(birthdayMillis === undefined ? {} : { birthdayMillis });
    const range = getStatisticsPredefinedDateRange("last7Days", undefined, NOW);
    const navigation = await current.baby.getStatisticsDateRange("last7Days", NOW);
    expect(navigation.range).toEqual(range);
    expect(navigation.canLoadPrevious).toBe(birthdayMillis === undefined || range.fromMillis > birthdayMillis);
    expect(navigation.canLoadNext).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("retains rejection of a supplied nonfinite birthday %s", (birthdayMillis) => {
    const range = getStatisticsPredefinedDateRange("last7Days", undefined, NOW);
    expect(() => canLoadPreviousStatisticsDateRange(range, birthdayMillis)).toThrow("must be finite");
    expect(() => buildStatisticsDateRangeNavigation(range, birthdayMillis, NOW)).toThrow("must be finite");
  });

  it.each([
    { fromMillis: 2, toMillis: 1 },
    { fromMillis: Number.NaN, toMillis: NOW },
  ])("validates %j even without a birthday", (range: StatisticsDateRange) => {
    expect(() => canLoadPreviousStatisticsDateRange(range)).toThrow(RangeError);
    expect(() => buildStatisticsDateRangeNavigation(range, undefined, NOW)).toThrow(RangeError);
  });

  it("retains calendar preset boundaries across a clock-change month", async () => {
    process.env.TZ = "America/Chicago";
    const current = fixture();
    await current.create();
    const now = new Date(2026, 2, 9, 12).getTime();
    const range = (await current.baby.getStatisticsDateRange("last7Days", now)).range;
    expect(range).toEqual({ fromMillis: new Date(2026, 2, 3).getTime(), toMillis: new Date(2026, 2, 10).getTime() - 1 });
    expect(range.toMillis - range.fromMillis + 1).toBe(167 * HOUR);
  });
});

describe("birthday-dependent and empty-profile behavior", () => {
  it("still requires a birthday for sinceBirthday before reading sleep history", async () => {
    const current = fixture();
    await current.create();
    const snapshot = structuredClone([...current.records]);
    await expect(current.baby.getStatisticsDateRange("sinceBirthday", NOW)).rejects.toThrow("does not have a birthday");
    await expect(current.sdk.sleep.statistics({ babyUid: "birthdayless", interval: "sinceBirthday" })).rejects.toThrow("does not have a birthday");
    expect(current.reads).not.toContain(`${PROFILE}/dailyActions`);
    expect([...current.records]).toEqual(snapshot);
  });

  it("restores sinceBirthday after a real birthday is explicitly supplied", async () => {
    const current = fixture();
    await current.create();
    await current.nap(Date.UTC(2026, 7, 26, 12));
    const ordinary = await current.sdk.sleep.statistics({ babyUid: "birthdayless" });
    const birthdayMillis = Date.UTC(2026, 7, 20);
    await current.baby.save({ birthdayMillis });
    const navigation = await current.baby.getStatisticsDateRange("sinceBirthday", NOW);
    expect(navigation).toEqual({ range: { fromMillis: birthdayMillis, toMillis: Date.UTC(2026, 7, 27) - 1 }, canLoadPrevious: false, canLoadNext: false });
    expect(await current.sdk.sleep.statistics({ babyUid: "birthdayless", interval: "sinceBirthday" })).toEqual(ordinary);
  });

  it.each(PRESETS)("returns empty sleep statistics for %s without a birthday", async (interval) => {
    const current = fixture();
    await current.create();
    const result = await current.sdk.sleep.statistics({ babyUid: "birthdayless", interval });
    expect(result.data).toMatchObject({ total: { totalDurationMillis: { value: 0 } } });
    expect(current.commits).toEqual([1, 59]);
  });

  it("keeps the missing-profile error distinct from an omitted birthday", async () => {
    const current = fixture();
    await expect(current.baby.getStatisticsDateRange("last7Days", NOW)).rejects.toThrow("does not exist");
    await expect(current.sdk.sleep.statistics({ babyUid: "birthdayless" })).rejects.toThrow("does not exist");
    expect(current.reads).toEqual([PROFILE, PROFILE]);
    expect(current.commits).toEqual([]);
  });
});

describe("default sleep-statistics command adapters", () => {
  it("returns the one-hour total through the CLI without explicit bounds", async () => {
    const current = fixture();
    await current.create();
    await current.nap(Date.UTC(2026, 7, 26, 12));
    const output: string[] = [];
    await runCLI(babyDaybookCommands, { argv: ["node", "baby-daybook", "sleep", "statistics", "birthdayless", "--output", "json"], services: current.services, env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, controls: { output: true }, outputEmitter: (entry) => { output.push(entry); }, errorReports: false });
    expect(JSON.parse(output.join("\n"))).toMatchObject({ data: { total: { totalDurationMillis: { value: HOUR } } } });
    expect(current.records.get(PROFILE)).not.toHaveProperty("birthdayMillis");
  });

  it("returns the one-hour total through MCP without explicit bounds", async () => {
    const current = fixture();
    await current.create();
    await current.nap(Date.UTC(2026, 7, 26, 12));
    const server = createMCPServer(babyDaybookCommands, { name: "birthdayless-fixture", version: "0.1.0", omitRootToolNamePrefix: true, services: current.services });
    const session = server.createMessageSession(() => undefined);
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1.0.0" } });
      const response = await session.handleMessage("tools/call", { name: "sleep__statistics", arguments: { baby_uid: "birthdayless" } }) as { result: { structuredContent: unknown; isError?: boolean } };
      expect(response.result.isError).not.toBe(true);
      expect(response.result.structuredContent).toMatchObject({ data: { total: { totalDurationMillis: { value: HOUR } } } });
    } finally { session.close(); }
  });
});
