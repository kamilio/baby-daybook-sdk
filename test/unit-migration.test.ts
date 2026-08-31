import { describe, expect, it, vi } from "vitest";
import { AuthSession, BabyDaybookClient, decodeFields, encodeFields, type BabyDaybookBackup } from "../src/index.js";
import { jsonResponse } from "./helpers.js";

const babyPath = "babyData/babyUid_baby";
const activityPath = `${babyPath}/dailyActions`;
const growthPath = `${babyPath}/growth`;

function fixture(count = 2) {
  const data = new Map<string, Record<string, unknown>>();
  const revisions = new Map<string, string>();
  let revision = 0;
  let stored: BabyDaybookBackup | undefined;
  let failPath: string | undefined;
  let failAfterWrite = false;
  let beforeCommit: (() => void) | undefined;
  const commits: unknown[] = [];
  function put(path: string, value: Record<string, unknown>) {
    data.set(path, structuredClone(value));
    revisions.set(path, new Date(++revision * 1_000).toISOString());
  }
  put(babyPath, { uid: "baby", userUid: "user", name: "Baby", convertUnits: 0 });
  for (let index = 0; index < count; index += 1) {
    put(`${activityPath}/bottle-${index}`, {
      uid: `bottle-${index}`, userUid: "user", babyUid: "baby", type: "bottle",
      startMillis: index, volume: 4, temperature: 98.6, updatedMillis: 111, notes: "Original", svt: 9,
    });
  }
  put(`${growthPath}/growth`, {
    uid: "growth", userUid: "user", babyUid: "baby", dateMillis: 100,
    weight: 22.0462262, height: 39.3700787, headSize: 19.68503935, updatedMillis: 222, svt: 9,
  });
  function wire(path: string) {
    return { name: `projects/p/databases/(default)/documents/${path}`, fields: encodeFields(data.get(path)!), updateTime: revisions.get(path) };
  }
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("documents:commit")) {
      const writes = JSON.parse(String(init?.body)).writes as Array<{
        update: { name: string; fields: Record<string, Record<string, unknown>> };
        updateMask?: { fieldPaths: string[] };
        currentDocument?: { updateTime: string };
      }>;
      commits.push(writes);
      beforeCommit?.();
      beforeCommit = undefined;
      const paths = writes.map((write) => write.update.name.split("/documents/")[1]!);
      for (const [index, write] of writes.entries()) {
        if (write.currentDocument && revisions.get(paths[index]!) !== write.currentDocument.updateTime) {
          return jsonResponse({ error: { message: "Record changed", status: "FAILED_PRECONDITION" } }, 409);
        }
      }
      const fail = paths.includes(failPath ?? "");
      if (fail) failPath = undefined;
      if (fail && !failAfterWrite) return jsonResponse({ error: { message: "Temporary failure" } }, 503);
      for (const [index, write] of writes.entries()) {
        const path = paths[index]!;
        put(path, { ...(write.updateMask ? data.get(path) : {}), ...decodeFields(write.update.fields), svt: revision + 1 });
      }
      if (fail) return jsonResponse({ error: { message: "Response lost" } }, 503);
      return jsonResponse({ writeResults: paths.map((path) => ({ updateTime: revisions.get(path) })) });
    }
    const path = decodeURIComponent(url.pathname.split("/documents/")[1]!);
    if (data.has(path)) return jsonResponse(wire(path));
    if (path.split("/").length % 2 === 0) return jsonResponse({ error: { message: "Not found" } }, 404);
    return jsonResponse({ documents: [...data.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")).map(wire) });
  });
  const client = () => new BabyDaybookClient({
    session: new AuthSession({ idToken: "fake", userId: "user", expiresAt: Date.now() + 3_600_000 }, { fetch }), fetch,
  }).baby("baby");
  const options = {
    temperatureFahrenheit: true, volumeFluidOunces: true,
    growthWeightPoundsAndOunces: true, growthHeightInches: true, growthHeadSizeInches: true,
    loadBackup: vi.fn(async () => structuredClone(stored)),
    persistBackup: vi.fn(async (backup: BabyDaybookBackup) => { stored = structuredClone(backup); }),
    atMillis: 1_000,
  };
  return {
    data, put, commits, client, options, revisions,
    backup: () => stored!,
    fail(path: string, afterWrite = false) { failPath = path; failAfterWrite = afterWrite; },
    beforeCommit(callback: () => void) { beforeCommit = callback; },
  };
}

describe("resumable unit migration", () => {
  it("reuses the original durable backup after a partial failure and process restart", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-1`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("Temporary failure");
    const backup = structuredClone(state.backup());

    const result = await state.client().migrateUnitsToMetric(state.options);
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBeCloseTo(118.2941182, 6);
    expect(state.data.get(`${activityPath}/bottle-1`)?.volume).toBeCloseTo(118.2941182, 6);
    expect(state.data.get(`${activityPath}/bottle-0`)).toMatchObject({ temperature: 37, updatedMillis: 111 });
    expect(state.data.get(`${growthPath}/growth`)).toMatchObject({ weight: expect.closeTo(10, 7), height: expect.closeTo(100, 6), headSize: expect.closeTo(50, 6), updatedMillis: 222 });
    expect(result).toMatchObject({ baby: { convertUnits: true }, convertedActivities: 1, convertedGrowthEntries: 1 });
    expect(result.backup).toEqual(backup);
    expect(state.backup()).toEqual(backup);
    expect(state.options.persistBackup).toHaveBeenCalledOnce();
  });

  it("recognizes an acknowledged-late write and preserves unrelated phone edits", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-0`, true);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("Response lost");
    state.put(`${activityPath}/bottle-0`, { ...state.data.get(`${activityPath}/bottle-0`), notes: "Phone correction" });
    await state.client().migrateUnitsToMetric(state.options);
    expect(state.data.get(`${activityPath}/bottle-0`)).toMatchObject({ notes: "Phone correction", volume: expect.closeTo(118.2941182, 6) });
  });

  it("does not repeat a completed conversion when the final response was lost", async () => {
    const state = fixture();
    state.fail(babyPath, true);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("Response lost");
    state.put(`${activityPath}/bottle-0`, { ...state.data.get(`${activityPath}/bottle-0`), volume: 130 });
    const commits = state.commits.length;
    await expect(state.client().migrateUnitsToMetric(state.options)).resolves.toMatchObject({ convertedActivities: 0, convertedGrowthEntries: 0 });
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBe(130);
    expect(state.commits).toHaveLength(commits);
  });

  it("does not guess the units of conflicting values on resume", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-1`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    state.put(`${activityPath}/bottle-0`, { ...state.data.get(`${activityPath}/bottle-0`), volume: 130 });
    const commits = state.commits.length;
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("conflict");
    expect(state.commits).toHaveLength(commits);
    expect(state.data.get(`${activityPath}/bottle-1`)?.volume).toBe(4);
  });

  it("preserves a phone edit that races the conditional conversion write", async () => {
    const state = fixture();
    state.beforeCommit(() => state.put(`${activityPath}/bottle-0`, { ...state.data.get(`${activityPath}/bottle-0`), volume: 6, notes: "New value" }));
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("Record changed");
    expect(state.data.get(`${activityPath}/bottle-0`)).toMatchObject({ volume: 6, notes: "New value" });
  });

  it("does not recreate a record deleted between attempts", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-0`, true);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    state.data.delete(`${activityPath}/bottle-1`);
    await state.client().migrateUnitsToMetric(state.options);
    expect(state.data.has(`${activityPath}/bottle-1`)).toBe(false);
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBeCloseTo(118.2941182, 6);
  });

  it("requires a backup reader before any backup or data is written", async () => {
    const state = fixture();
    const options = { ...state.options, loadBackup: undefined } as unknown as typeof state.options;
    await expect(state.client().migrateUnitsToMetric(options)).rejects.toThrow("loadBackup");
    expect(state.commits).toEqual([]);
    expect(state.options.persistBackup).not.toHaveBeenCalled();
  });

  it("rejects changed source-unit options on resume", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-0`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    const commits = state.commits.length;
    await expect(state.client().migrateUnitsToMetric({ ...state.options, volumeFluidOunces: false })).rejects.toThrow("source units");
    expect(state.commits).toHaveLength(commits);
  });

  it("stops before writes when new measurement records are absent from the source backup", async () => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-0`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    state.put(`${activityPath}/new`, { ...state.data.get(`${activityPath}/bottle-0`), uid: "new" });
    const commits = state.commits.length;
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("migration backup");
    expect(state.commits).toHaveLength(commits);
  });

  it("preserves zero, absent, and deleted measurements and waits for durable persistence", async () => {
    const state = fixture(1);
    state.put(`${activityPath}/zero`, { ...state.data.get(`${activityPath}/bottle-0`), uid: "zero", volume: 0, temperature: undefined });
    state.put(`${activityPath}/deleted`, { ...state.data.get(`${activityPath}/bottle-0`), uid: "deleted", deleted: 1 });
    state.put(`${growthPath}/deleted`, { ...state.data.get(`${growthPath}/growth`), uid: "deleted", deleted: true });
    const originalPersist = state.options.persistBackup.getMockImplementation()!;
    state.options.persistBackup.mockImplementationOnce(async (backup) => {
      expect(state.commits).toEqual([]);
      await originalPersist(backup);
      backup.activities[0]!.volume = 999;
    });
    const result = await state.client().migrateUnitsToMetric(state.options);
    expect(result).toMatchObject({ convertedActivities: 1, convertedGrowthEntries: 1, baby: { updatedMillis: 1_000 } });
    expect(result.backup.activities[0]!.volume).toBe(4);
    expect(state.data.get(`${activityPath}/zero`)).toMatchObject({ volume: 0, svt: 9 });
    expect(state.data.get(`${activityPath}/deleted`)).toMatchObject({ volume: 4, deleted: 1, svt: 9 });
    expect(state.data.get(`${growthPath}/deleted`)).toMatchObject({ weight: 22.0462262, deleted: true, svt: 9 });
    expect(state.data.get(`${activityPath}/bottle-0`)?.svt).not.toBe(9);
  });

  it.each(["load", "persist"] as const)("does not mutate records if backup %s fails", async (operation) => {
    const state = fixture();
    if (operation === "load") state.options.loadBackup.mockRejectedValueOnce(new Error("disk failure"));
    else state.options.persistBackup.mockRejectedValueOnce(new Error("disk failure"));
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("disk failure");
    expect(state.commits).toEqual([]);
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBe(4);
  });

  it.each([
    ["format", (backup: BabyDaybookBackup) => { (backup as any).format = "other"; }],
    ["version", (backup: BabyDaybookBackup) => { (backup as any).version = 1; }],
    ["manifest", (backup: BabyDaybookBackup) => { delete backup.unitMigration; }],
    ["baby", (backup: BabyDaybookBackup) => { backup.baby.uid = "other"; }],
    ["metric source", (backup: BabyDaybookBackup) => { backup.baby.convertUnits = true; }],
    ["duplicate", (backup: BabyDaybookBackup) => { backup.activities.push(backup.activities[0]!); }],
    ["record baby", (backup: BabyDaybookBackup) => { backup.activities[0]!.babyUid = "other"; }],
    ["array", (backup: BabyDaybookBackup) => { (backup as any).growth = null; }],
    ["number", (backup: BabyDaybookBackup) => { backup.activities[0]!.volume = Number.NaN; }],
    ["overflow", (backup: BabyDaybookBackup) => { backup.activities[0]!.volume = Number.MAX_VALUE; }],
  ] as const)("rejects an invalid %s in the loaded backup before writes", async (_name, invalidate) => {
    const state = fixture();
    state.fail(`${activityPath}/bottle-0`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    const backup = structuredClone(state.backup());
    invalidate(backup);
    state.options.loadBackup.mockResolvedValueOnce(backup);
    const commits = state.commits.length;
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow();
    expect(state.commits).toHaveLength(commits);
    expect(state.options.persistBackup).toHaveBeenCalledOnce();
  });

  it("does not create another backup for a profile already marked metric", async () => {
    const state = fixture();
    state.put(babyPath, { ...state.data.get(babyPath), convertUnits: 1 });
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("already uses metric");
    expect(state.options.persistBackup).not.toHaveBeenCalled();
    expect(state.commits).toEqual([]);
  });

  it("keeps an unselected measurement dimension unchanged", async () => {
    const state = fixture(1);
    await state.client().migrateUnitsToMetric({ ...state.options, temperatureFahrenheit: false, growthWeightPoundsAndOunces: false });
    expect(state.data.get(`${activityPath}/bottle-0`)).toMatchObject({ temperature: 98.6, volume: expect.closeTo(118.2941182, 6) });
    expect(state.data.get(`${growthPath}/growth`)).toMatchObject({ weight: 22.0462262, height: expect.closeTo(100, 6) });
  });

  it("resumes a history larger than a Firestore write batch", async () => {
    const state = fixture(501);
    state.fail(`${activityPath}/bottle-500`);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("Temporary failure");
    const result = await state.client().migrateUnitsToMetric(state.options);
    expect(result.convertedActivities).toBe(1);
    for (let index = 0; index < 501; index += 1) {
      expect(state.data.get(`${activityPath}/bottle-${index}`)?.volume).toBeCloseTo(118.2941182, 6);
    }
    expect(state.options.persistBackup).toHaveBeenCalledOnce();
  });

  it.each([babyPath, `${activityPath}/bottle-0`])("does not write %s without a document revision", async (path) => {
    const state = fixture();
    state.revisions.delete(path);
    await expect(state.client().migrateUnitsToMetric(state.options)).rejects.toThrow("updateTime");
    expect(state.commits).toEqual([]);
  });

  it("does not mark completion if measurements change back during the migration", async () => {
    const state = fixture();
    const getClient = state.client;
    const baby = getClient();
    const setMany = baby.client.firestore.setMany.bind(baby.client.firestore);
    vi.spyOn(baby.client.firestore, "setMany").mockImplementation(async (writes) => {
      await setMany(writes);
      if (writes[0]?.path === `${growthPath}/growth`) {
        state.put(`${activityPath}/bottle-0`, { ...state.data.get(`${activityPath}/bottle-0`), volume: 4 });
      }
    });
    await expect(baby.migrateUnitsToMetric(state.options)).rejects.toThrow("values changed during conversion");
    expect(state.data.get(babyPath)?.convertUnits).toBe(0);
    await state.client().migrateUnitsToMetric(state.options);
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBeCloseTo(118.2941182, 6);
  });

  it("keeps newly added non-measurement records without replacing the original backup", async () => {
    const state = fixture(1);
    const persist = state.options.persistBackup.getMockImplementation()!;
    state.options.persistBackup.mockImplementationOnce(async (backup) => {
      await persist(backup);
      state.put(`${activityPath}/note`, { uid: "note", babyUid: "baby", userUid: "user", type: "sleeping", startMillis: 5, notes: "New note" });
    });
    await state.client().migrateUnitsToMetric(state.options);
    expect(state.data.get(`${activityPath}/note`)?.notes).toBe("New note");
    expect(state.backup().activities).toHaveLength(1);
  });

  it("uses exclusive backup creation to coordinate concurrent first attempts", async () => {
    const state = fixture();
    const persist = state.options.persistBackup.getMockImplementation()!;
    state.options.persistBackup.mockImplementation(async (backup) => {
      if (state.backup()) throw new Error("Backup already exists");
      await persist(backup);
    });
    const results = await Promise.allSettled([
      state.client().migrateUnitsToMetric(state.options),
      state.client().migrateUnitsToMetric(state.options),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(state.backup().activities[0]!.volume).toBe(4);
    await expect(state.client().migrateUnitsToMetric(state.options)).resolves.toMatchObject({ convertedActivities: 0, convertedGrowthEntries: 0 });
    expect(state.data.get(`${activityPath}/bottle-0`)?.volume).toBeCloseTo(118.2941182, 6);
  });
});
