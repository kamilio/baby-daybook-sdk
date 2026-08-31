import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { BabyDaybookClient, BabyDaybookError, BabyDaybookRestoreError, buildPointActivity, decodeFields, encodeFields, type BabyDaybookBackup } from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const failures = new Set<string>();
  const readFailures = new Set<string>();
  const heldStarted = deferred();
  const heldAllowed = deferred();
  const failureReturned = deferred();
  let heldUid: string | undefined;
  let holdReadback = false;
  const client = new BabyDaybookClient({
    session: { idToken: "fake-token", userId: "user", expiresAt: Date.now() + 3_600_000 },
    fetch: async (input, options) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("firestore.googleapis.com");
      if ((options?.method ?? "GET") === "GET") {
        const name = url.pathname.slice("/v1/".length);
        if (holdReadback && name.endsWith(`/${heldUid}`)) {
          heldStarted.resolve();
          await heldAllowed.promise;
        }
        if (readFailures.has(name.split("/").at(-1)!)) return Response.json({ error: { message: "Readback failed", status: "UNAVAILABLE" } }, { status: 503 });
        return Response.json({ name, fields: encodeFields(records.get(name)!) });
      }
      const body = JSON.parse(String(options?.body));
      expect(body.writes).toHaveLength(1);
      const write = body.writes[0];
      const name = write.update.name as string;
      const uid = name.split("/").at(-1)!;
      writes.push(uid);
      if (!holdReadback && uid === heldUid) {
        heldStarted.resolve();
        await heldAllowed.promise;
      }
      if (failures.has(uid)) {
        if (heldUid) await heldStarted.promise;
        failureReturned.resolve();
        return Response.json({ error: { message: `Restore failed for ${uid}`, status: "UNAVAILABLE" } }, { status: 503 });
      }
      records.set(name, { ...(write.updateMask ? records.get(name) : {}), ...decodeFields(write.update.fields), svt: 1 });
      return Response.json({ writeResults: [{}] });
    },
  });
  const baby = client.baby("baby");
  const backup: BabyDaybookBackup = {
    format: "baby-daybook-sdk-backup", version: 2, createdAt: "2026-08-31T00:00:00.000Z",
    baby: { uid: "baby", userUid: "user", name: "Synthetic baby" },
    activities: ["fails", "late"].map((uid) => buildPointActivity({ uid, type: "bottle", startMillis: 60_000, volume: 90 }, { userUid: "user", babyUid: "baby", updatedMillis: 1_000 })),
    activityTypes: [], groups: [], growth: [], moments: [], dailyNotes: [], teething: [], reminders: [], settings: [],
    files: { dailyActions: [], growth: [], moments: [], teething: [] }, attachmentsIncluded: false, attachments: [],
  };
  return {
    client, baby, backup, writes, failures, readFailures, heldStarted, heldAllowed, failureReturned,
    hold(uid: string, readback = false) { heldUid = uid; holdReadback = readback; },
  };
}

describe("settled backup restore failures", () => {
  for (const readback of [false, true]) {
    it(`waits for an already-started ${readback ? "readback" : "write"} before reporting failure`, async () => {
      const state = fixture();
      state.failures.add("fails");
      state.hold("late", readback);
      let settled = false;
      const restoring = state.baby.restoreBackup(state.backup).then(
        () => { settled = true; return undefined; },
        (error: unknown) => { settled = true; return error; },
      );
      try {
        await state.failureReturned.promise;
        await setImmediate();
        expect(settled).toBe(false);
        state.heldAllowed.resolve();
        expect(await restoring).toMatchObject({ name: "BabyDaybookRestoreError" });
        const corrected = await state.baby.saveActivity({ ...state.backup.activities[1]!, volume: 120, notes: "Correction after settled restore" }, 2_000);
        expect(corrected.volume).toBe(120);
        await setImmediate();
        expect(await state.baby.activities.get("late")).toMatchObject({ volume: 120, notes: "Correction after settled restore", updatedMillis: 2_000 });
      } finally {
        state.heldAllowed.resolve();
        await restoring;
      }
    });
  }

  it("reports every record outcome and retains every original error", async () => {
    const state = fixture();
    state.failures.add("fails");
    state.failures.add("late");
    state.backup.activities.push({ ...state.backup.activities[0]!, uid: "success" });
    const error = await state.baby.restoreBackup(state.backup).catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      name: "BabyDaybookRestoreError",
      code: "BACKUP_RESTORE_FAILED",
      outcomes: [
        { target: { section: "baby", uid: "baby" }, status: "fulfilled" },
        { target: { section: "activities", uid: "fails" }, status: "rejected", reason: expect.objectContaining({ status: 503 }) },
        { target: { section: "activities", uid: "late" }, status: "rejected", reason: expect.objectContaining({ status: 503 }) },
        { target: { section: "activities", uid: "success" }, status: "fulfilled" },
      ],
      errors: [expect.objectContaining({ message: "Restore failed for fails" }), expect.objectContaining({ message: "Restore failed for late" })],
      cause: expect.objectContaining({ message: "Restore failed for fails" }),
    });
    expect(await state.baby.activities.get("success")).toMatchObject({ volume: 90 });
  });

  it("does not start record writes when restoring the profile fails", async () => {
    const state = fixture();
    state.failures.add("babyUid_baby");
    await expect(state.baby.restoreBackup(state.backup)).rejects.toMatchObject({
      name: "BabyDaybookRestoreError",
      outcomes: [
        { target: { section: "baby", uid: "baby" }, status: "rejected" },
        { target: { section: "activities", uid: "fails" }, status: "not-started" },
        { target: { section: "activities", uid: "late" }, status: "not-started" },
      ],
    });
    expect(state.writes).toEqual(["babyUid_baby"]);
  });

  it("drains earlier saves even when another save throws synchronously", async () => {
    const state = fixture();
    state.hold("fails");
    const original = state.baby.activities.save.bind(state.baby.activities);
    vi.spyOn(state.baby.activities, "save").mockImplementation((item) => {
      if (item.uid === "late") throw new Error("Synchronous save failure");
      return original(item);
    });
    let settled = false;
    const restoring = state.baby.restoreBackup(state.backup).catch((error: unknown) => { settled = true; return error; });
    try {
      await state.heldStarted.promise;
      await setImmediate();
      expect(settled).toBe(false);
      state.heldAllowed.resolve();
      expect(await restoring).toMatchObject({ name: "BabyDaybookRestoreError", cause: expect.objectContaining({ message: "Synchronous save failure" }) });
    } finally {
      state.heldAllowed.resolve();
      await restoring;
    }
  });

  it("reports completed attachments and leaves later stages unstarted after upload failure", async () => {
    const state = fixture();
    state.backup.attachmentsIncluded = true;
    for (const fileName of ["one.jpg", "two.jpg", "three.jpg"]) {
      state.backup.files.moments.push({ babyUid: "baby", itemUid: "moment", fileName, deleted: false });
      state.backup.attachments.push({ category: "moments", itemUid: "moment", fileName, contentType: "image/jpeg", dataBase64: "aW1hZ2U=" });
    }
    const upload = vi.spyOn(state.client.storage, "upload").mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Upload failed"));
    await expect(state.baby.restoreBackup(state.backup)).rejects.toMatchObject({
      name: "BabyDaybookRestoreError",
      outcomes: [
        { target: { section: "attachments", category: "moments", itemUid: "moment", fileName: "one.jpg" }, status: "fulfilled" },
        { target: { section: "attachments", category: "moments", itemUid: "moment", fileName: "two.jpg" }, status: "rejected" },
        { target: { section: "attachments", category: "moments", itemUid: "moment", fileName: "three.jpg" }, status: "not-started" },
        { target: { section: "baby", uid: "baby" }, status: "not-started" },
        { target: { section: "activities", uid: "fails" }, status: "not-started" },
        { target: { section: "activities", uid: "late" }, status: "not-started" },
      ],
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(state.writes).toEqual([]);
  });

  it("waits for a delayed rejection and includes it in the final report", async () => {
    const state = fixture();
    state.failures.add("fails");
    state.failures.add("late");
    state.hold("late");
    let settled = false;
    const restoring = state.baby.restoreBackup(state.backup).catch((error: unknown) => { settled = true; return error; });
    try {
      await state.failureReturned.promise;
      await setImmediate();
      expect(settled).toBe(false);
      state.heldAllowed.resolve();
      expect(await restoring).toMatchObject({ errors: [expect.objectContaining({ message: "Restore failed for fails" }), expect.objectContaining({ message: "Restore failed for late" })] });
    } finally {
      state.heldAllowed.resolve();
      await restoring;
    }
  });

  it("identifies a rejected save even when its commit succeeded but readback failed", async () => {
    const state = fixture();
    state.readFailures.add("late");
    const error = await state.baby.restoreBackup(state.backup).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(BabyDaybookRestoreError);
    expect(error).toMatchObject({
      outcomes: [
        { status: "fulfilled" },
        { status: "fulfilled" },
        { target: { section: "activities", uid: "late" }, status: "rejected", reason: expect.objectContaining({ message: "Readback failed" }) },
      ],
    });
    state.readFailures.clear();
    expect(await state.baby.activities.get("late")).toMatchObject({ volume: 90 });
  });

  it("includes all nine record sections and retains non-Error rejections", async () => {
    const state = fixture();
    const sections = ["activityTypes", "activities", "groups", "growth", "moments", "dailyNotes", "teething", "reminders", "settings"] as const;
    for (const section of sections) {
      const record = { uid: section };
      Object.assign(state.backup, { [section]: [record] });
      const save = vi.spyOn(state.baby[section], "save").mockResolvedValue(record as never);
      if (section === "groups") save.mockRejectedValue("plain rejection");
    }
    const error = await state.baby.restoreBackup(state.backup).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(BabyDaybookError);
    expect(error).toBeInstanceOf(BabyDaybookRestoreError);
    expect(error).toMatchObject({
      cause: "plain rejection", errors: ["plain rejection"],
      outcomes: [
        { target: { section: "baby", uid: "baby" }, status: "fulfilled" },
        ...sections.map((section) => ({ target: { section, uid: section }, status: section === "groups" ? "rejected" : "fulfilled" })),
      ],
    });
    for (const section of sections) expect(state.baby[section].save).toHaveBeenCalledExactlyOnceWith({ uid: section });
  });

  it("keeps successful restore compatible and uploads attachments before record writes", async () => {
    const state = fixture();
    state.backup.attachmentsIncluded = true;
    state.backup.files.moments.push({ babyUid: "baby", itemUid: "moment", fileName: "one.jpg", deleted: false });
    state.backup.attachments.push({ category: "moments", itemUid: "moment", fileName: "one.jpg", contentType: "image/jpeg", dataBase64: "aW1hZ2U=" });
    const upload = vi.spyOn(state.client.storage, "upload").mockImplementation(async () => {
      expect(state.writes).toEqual([]);
      return {};
    });
    await expect(state.baby.restoreBackup(state.backup)).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledOnce();
    expect(state.writes).toEqual(["babyUid_baby", "fails", "late"]);
  });

  it("supports an empty metadata-only backup without phantom outcomes", async () => {
    const state = fixture();
    state.backup.activities = [];
    await expect(state.baby.restoreBackup(state.backup)).resolves.toBeUndefined();
    expect(state.writes).toEqual(["babyUid_baby"]);
  });

  it("rejects malformed record arrays before starting any restore writes", async () => {
    const state = fixture();
    Object.assign(state.backup, { settings: undefined });
    await expect(state.baby.restoreBackup(state.backup)).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
});
