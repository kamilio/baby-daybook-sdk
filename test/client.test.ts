import { describe, expect, it, vi } from "vitest";
import { AuthSession, BabyClient, BabyDaybookClient } from "../src/index.js";
import type { Baby, DailyAction, GrowthEntry } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("BabyDaybookClient", () => {
  it("loads, saves, creates, lists, and deletes account data", async () => {
    const client = baseClient();
    const firestore = {
      get: vi.fn(async (path: string) => path.startsWith("userData/")
        ? { data: { uid: "user", displayName: "Parent" } }
        : { data: { uid: "baby", userUid: "user", name: "Baby" } }),
      set: vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data })),
    };
    (client as any).firestore = firestore;
    (client as any).userCreatedBabies = repo([{ babyUid: "baby" }]);
    (client as any).userAcceptedInvites = repo([{ babyUid: "baby" }, { babyUid: "shared" }]);
    (client as any).functions = { call: vi.fn(async () => "deleted") };

    await expect(client.getUser()).resolves.toMatchObject({ displayName: "Parent" });
    await expect(client.saveUser({ uid: "user", displayName: "Updated" })).resolves.toMatchObject({ displayName: "Updated" });
    await expect(client.listBabies()).resolves.toHaveLength(2);
    await expect(client.getBaby("baby")).resolves.toMatchObject({ uid: "baby" });
    await expect(client.createBaby({ uid: "new", name: "New" })).resolves.toMatchObject({ uid: "new", userUid: "user" });
    await expect(client.deleteAccount()).resolves.toBe("deleted");
    expect(client.baby("baby")).toBeInstanceOf(BabyClient);
  });
});

describe("BabyClient", () => {
  it("edits the baby and controls timed activities", async () => {
    const { baby, activityRepo } = configuredBaby();
    await expect(baby.get()).resolves.toMatchObject({ uid: "baby" });
    await expect(baby.save({ name: "Updated" })).resolves.toMatchObject({ name: "Updated" });
    await expect(baby.softDelete()).resolves.toMatchObject({ deleted: true });

    const started = await baby.startActivity({ uid: "activity", type: "sleeping", startMillis: 100 });
    expect(started).toMatchObject({ uid: "activity", inProgress: true, babyUid: "baby", userUid: "user" });
    activityRepo.items = [started];
    await expect(baby.pauseActivity("activity", 200)).resolves.toMatchObject({ pauseMillis: 200, inProgress: false });
    activityRepo.items = [{ ...started, pauseMillis: 200, inProgress: false }];
    await expect(baby.resumeActivity("activity", 300)).resolves.toMatchObject({ startMillis: 200, inProgress: true });
    activityRepo.items = [{ ...started, side: "left", leftDuration: 10, rightDuration: 5 }];
    await expect(baby.switchBreastfeedingSide("activity", "right", 130)).resolves.toMatchObject({ side: "right", leftDuration: 25 });
    activityRepo.items = [started];
    await expect(baby.stopActivity("activity", 500)).resolves.toMatchObject({ endMillis: 500, duration: 400, inProgress: false });
  });

  it("manages attachments, summaries, CSV, and backups", async () => {
    const { baby, client, activityRepo, growthRepo } = configuredBaby();
    const metadata = repo<{ itemUid: string; babyUid: string; fileName: string; deleted?: boolean }>([]);
    (baby as any).fileMetadata = vi.fn(() => metadata);
    (client as any).storage = {
      attachmentPath: vi.fn(() => "path"),
      upload: vi.fn(async () => ({})),
      download: vi.fn(async () => new Uint8Array([1, 2])),
      delete: vi.fn(async () => undefined),
    };
    activityRepo.items = [activity({ uid: "a", type: "bottle", duration: 100, volume: 60 })];
    growthRepo.items = [{ uid: "g", userUid: "user", babyUid: "baby", dateMillis: 100, weight: 5 }];
    (baby as any).dailyNotes = repo([{ uid: "19700101", userUid: "user", babyUid: "baby", note: "First note" }]);
    (baby as any).activityTypes = repo([{ uid: "bottle", userUid: "user", babyUid: "baby", title: "Bottle feeding" }]);

    await expect(baby.uploadAttachment("moments", "m", "photo.jpg", "image")).resolves.toMatchObject({ itemUid: "m" });
    await expect(baby.downloadAttachment("moments", "m", "photo.jpg")).resolves.toEqual(new Uint8Array([1, 2]));
    metadata.items = [{ itemUid: "m", babyUid: "baby", fileName: "photo.jpg" }];
    await baby.deleteAttachment("moments", "m", "photo.jpg");
    await expect(baby.summarizeActivities()).resolves.toMatchObject({ count: 1, totalVolume: 60 });
    await expect(baby.exportActivitiesCsv()).resolves.toContain("bottle");
    const activityPdf = new TextDecoder().decode(await baby.exportActivitiesPdf({ timeZone: "UTC" }));
    expect(activityPdf).toContain("Day note: First note");
    expect(activityPdf).toContain("Bottle feeding");
    await expect(baby.exportGrowthPdf()).resolves.toEqual(expect.any(Uint8Array));
    await expect(baby.exportTimelinePdf()).resolves.toEqual(expect.any(Uint8Array));

    const backup = await baby.createBackup();
    expect(backup).toMatchObject({ format: "baby-daybook-sdk-backup", baby: { uid: "baby" } });
    await baby.restoreBackup(backup);
  });

  it("rejects invalid backups and missing activities", async () => {
    const { baby } = configuredBaby();
    await expect(baby.stopActivity("missing")).rejects.toThrow("does not exist");
    await expect(baby.pauseActivity("missing")).rejects.toThrow("does not exist");
    await expect(baby.resumeActivity("missing")).rejects.toThrow("does not exist");
    await expect(baby.switchBreastfeedingSide("missing", "right")).rejects.toThrow("does not exist");
    await expect(baby.restoreBackup({ format: "bad" } as any)).rejects.toThrow("Unsupported");
    const backup = await baby.createBackup();
    await expect(baby.restoreBackup({ ...backup, baby: { ...backup.baby, uid: "other" } })).rejects.toThrow("belongs to baby other");
  });

  it("emits polling changes and stops when aborted", async () => {
    const { baby, activityRepo } = configuredBaby();
    activityRepo.items = [activity({ uid: "a" })];
    const controller = new AbortController();
    const iterator = baby.watch({ intervalMillis: 1, signal: controller.signal });
    const first = await iterator.next();
    expect(first.value).toEqual(expect.arrayContaining([expect.objectContaining({ collection: "dailyActions", id: "a", type: "added" })]));
    controller.abort();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});

function baseClient(): BabyDaybookClient {
  const fetch = mockFetch();
  return new BabyDaybookClient({ session: new AuthSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 }, { fetch }), fetch });
}

function configuredBaby() {
  const client = baseClient();
  const babyData: Baby = { uid: "baby", userUid: "user", name: "Baby" };
  (client as any).getBaby = vi.fn(async () => babyData);
  (client as any).firestore = {
    set: vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data })),
  };
  (client as any).userCreatedBabies = repo([{ babyUid: "baby" }]);
  const baby = new BabyClient(client, "baby");
  const activityRepo = repo<DailyAction>([]);
  const growthRepo = repo<GrowthEntry>([]);
  (baby as any).activityTypes = repo([]);
  (baby as any).activities = activityRepo;
  (baby as any).groups = repo([]);
  (baby as any).growth = growthRepo;
  (baby as any).moments = repo([]);
  (baby as any).dailyNotes = repo([]);
  (baby as any).teething = repo([]);
  (baby as any).reminders = repo([]);
  (baby as any).settings = repo([]);
  (baby as any).fileMetadata = vi.fn(() => repo([]));
  return { baby, client, activityRepo, growthRepo };
}

function repo<T extends Record<string, any>>(initial: T[]) {
  return {
    items: [...initial],
    list: vi.fn(async function (this: { items: T[] }) { return [...this.items]; }),
    get: vi.fn(async function (this: { items: T[] }, id: string) { return this.items.find((item) => item.uid === id || item.babyUid === id || item.itemUid === id); }),
    save: vi.fn(async function (this: { items: T[] }, item: T) {
      const id = item.uid ?? item.babyUid ?? item.itemUid ?? item.settingType;
      this.items = [...this.items.filter((value) => (value.uid ?? value.babyUid ?? value.itemUid ?? value.settingType) !== id), item];
      return item;
    }),
    softDelete: vi.fn(async function (this: { items: T[] }, id: string) {
      const item = this.items.find((value) => value.uid === id || value.babyUid === id || value.itemUid === id);
      const deleted = { ...item, deleted: true } as unknown as T;
      this.items = [...this.items.filter((value) => value !== item), deleted];
      return deleted;
    }),
  };
}

function activity(update: Partial<DailyAction> = {}): DailyAction {
  return { uid: "id", userUid: "user", babyUid: "baby", type: "other", startMillis: 0, ...update };
}
