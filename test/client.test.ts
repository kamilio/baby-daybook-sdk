import { describe, expect, it, vi } from "vitest";
import { BABY_DAYBOOK_ACTIVITY_TYPE_COLORS, AuthSession, BabyClient, BabyDaybookClient } from "../src/index.js";
import type { ActivityGroup, ActivityType, Baby, BabySetting, DailyAction, DailyNote, GrowthEntry, Moment, Reminder, Tooth } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("BabyDaybookClient", () => {
  it("loads, saves, creates, lists, and deletes account data", async () => {
    const client = baseClient();
    const firestore = {
      get: vi.fn(async (path: string) => path.startsWith("userData/")
        ? { data: { uid: "user", displayName: "Parent" } }
        : { data: { uid: "baby", userUid: "user", name: "Baby" } }),
      set: vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data })),
      setMany: vi.fn(async (writes: Array<{ path: string; data: Record<string, unknown> }>) => void writes),
    };
    (client as any).firestore = firestore;
    (client as any).userCreatedBabies = repo([{ babyUid: "baby" }]);
    (client as any).userAcceptedInvites = repo([{ babyUid: "baby" }, { babyUid: "shared" }]);
    (client as any).functions = { call: vi.fn(async () => "deleted") };
    const updateAccount = vi.fn(async () => ({ localId: "user", displayName: "New Parent" }));
    const linkEmailPassword = vi.fn(async () => ({ localId: "user", email: "parent@example.com" }));
    const sendEmailVerification = vi.fn(async () => undefined);
    const signOut = vi.fn(async () => undefined);
    (client as any).auth = { linkEmailPassword, sendEmailVerification, updateAccount, signOut };

    await expect(client.getUser()).resolves.toMatchObject({ displayName: "Parent" });
    await expect(client.saveUser({ uid: "user", displayName: "Updated" })).resolves.toMatchObject({ displayName: "Updated" });
    await expect(client.listBabies()).resolves.toHaveLength(2);
    await expect(client.getBaby("baby")).resolves.toMatchObject({ uid: "baby" });
    await expect(client.createBaby({ uid: "new", name: "New" })).resolves.toMatchObject({ uid: "new", userUid: "user" });
    const creationWrites = firestore.setMany.mock.calls[0]![0];
    expect(creationWrites).toHaveLength(61);
    expect(creationWrites[0]).toMatchObject({ path: "babyData/babyUid_new", data: { uid: "new", userUid: "user", name: "New" } });
    expect(creationWrites[1]).toMatchObject({ path: "userData/user/createdBabies/new", data: { babyUid: "new", deleted: false } });
    expect(creationWrites.filter((write: { path: string }) => write.path.includes("/daTypes/"))).toHaveLength(20);
    expect(creationWrites.find((write: { path: string }) => write.path.endsWith("/daTypes/food"))).toMatchObject({
      data: { uid: "food", title: "", color: "#F69601", icon: "bib", category: "feeding", hasAmount: true, hasReaction: true },
    });
    const groupWrites = creationWrites.filter((write: { path: string }) => write.path.includes("/groups/"));
    expect(groupWrites).toHaveLength(39);
    expect(groupWrites[0]).toMatchObject({ data: { title: "Mother’s milk", daType: "bottle", description: "", userUid: "" } });
    expect(groupWrites[0]!.data.uid).toMatch(/^[0-9A-Za-z]{16}$/);
    await expect(client.deleteAccount()).resolves.toBeUndefined();
    await expect(client.updateDisplayName("  New Parent  ")).resolves.toMatchObject({ displayName: "New Parent" });
    expect(updateAccount).toHaveBeenCalledWith(client.session, { displayName: "New Parent" });
    await expect(client.linkEmailPassword("parent@example.com", "generated-password")).resolves.toMatchObject({ email: "parent@example.com" });
    expect(linkEmailPassword).toHaveBeenCalledWith(client.session, "parent@example.com", "generated-password");
    await client.sendEmailVerification();
    expect(sendEmailVerification).toHaveBeenCalledWith(client.session);
    await expect(client.updateDisplayName("  ")).rejects.toThrow(RangeError);
    await client.signOut();
    expect(signOut).toHaveBeenCalledWith(client.session);
    expect(client.baby("baby")).toBeInstanceOf(BabyClient);
  });

  it("localizes default groups before committing baby creation", async () => {
    const client = baseClient();
    const setMany = vi.fn(async (writes: Array<{ path: string; data: Record<string, unknown> }>) => void writes);
    (client as any).firestore = { setMany };

    await client.createBaby({ uid: "localized", name: "Localized" }, {
      resolveDefaultGroupTitle: ({ messageKey, title }) => `${messageKey}:${title}`,
    });

    const writes = setMany.mock.calls[0]![0];
    expect(writes.find((write: { data: Record<string, unknown> }) => write.data.daType === "bottle" && write.data.title !== ""))
      .toMatchObject({ data: { title: "mothers_milk:Mother’s milk" } });
  });

  it("does not fall back to partial writes when baby initialization fails", async () => {
    const client = baseClient();
    const failure = new Error("commit rejected");
    const setMany = vi.fn(async (writes: Array<{ path: string; data: Record<string, unknown> }>) => {
      void writes;
      return Promise.reject(failure);
    });
    const set = vi.fn();
    (client as any).firestore = { setMany, set };

    await expect(client.createBaby({ uid: "failed", name: "Failed" })).rejects.toBe(failure);
    expect(setMany).toHaveBeenCalledTimes(1);
    expect(setMany.mock.calls[0]![0]).toHaveLength(61);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("BabyClient", () => {
  it("exposes native last, active, overlap, and group-amount queries", async () => {
    const { baby, activityRepo } = configuredBaby();
    activityRepo.items = [
      activity({ uid: "old", type: "bottle", startMillis: 100, groupUid: "formula", amount: 90, amountUnit: "ml" }),
      activity({ uid: "new", type: "bottle", startMillis: 200, groupUid: "formula", amount: 120, amountUnit: "ml", inProgress: true }),
      activity({ uid: "sleep", type: "sleeping", startMillis: 150, inProgress: true }),
    ];

    await expect(baby.getLastActivity("bottle", { atMillis: 1_000 })).resolves.toMatchObject({ uid: "new" });
    await expect(baby.getLastActivities(["bottle", "sleeping"], 1_000)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: "new" }),
      expect.objectContaining({ uid: "sleep" }),
    ]));
    await expect(baby.getInProgressActivity("bottle")).resolves.toMatchObject({ uid: "new" });
    await expect(baby.getLastAmountForGroup("bottle", "formula")).resolves.toEqual({ amount: 120, amountUnit: "ml" });
    await expect(baby.hasOverlappingActivity(activity({ uid: "candidate", type: "bottle", startMillis: 150, endMillis: 250 }))).resolves.toBe(true);
  });

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

  it("deletes custom activity types with the native cascade order", async () => {
    const { baby, client, activityRepo } = configuredBaby();
    const activityTypes = repo<ActivityType>([
      { uid: "custom", userUid: "user", babyUid: "baby", title: "Custom" },
    ]);
    const groups = repo<ActivityGroup>([
      { uid: "custom-group", userUid: "user", babyUid: "baby", title: "Custom group", daType: "custom" },
      { uid: "bottle-group", userUid: "user", babyUid: "baby", title: "Bottle group", daType: "bottle" },
    ]);
    const reminders = repo<Reminder>([
      { uid: "custom-reminder", userUid: "user", babyUid: "baby", type: "basic", dateMillis: 100, daType: "custom" },
      { uid: "bottle-reminder", userUid: "user", babyUid: "baby", type: "basic", dateMillis: 100, daType: "bottle" },
    ]);
    const settings = repo<BabySetting>([
      { uid: "config", babyUid: "baby", settingType: "DA_TYPES_CONFIG", params: JSON.stringify({ daTypesConfig: "stale" }) },
    ]);
    activityRepo.items = [
      activity({ uid: "custom-activity", type: "custom" }),
      activity({ uid: "bottle-activity", type: "bottle" }),
    ];
    (client as any).getBaby = vi.fn(async () => ({
      uid: "baby",
      userUid: "user",
      name: "Baby",
      daTypesConfig: "bottle,custom,sleeping",
    }));
    (baby as any).activityTypes = activityTypes;
    (baby as any).groups = groups;
    (baby as any).reminders = reminders;
    (baby as any).settings = settings;

    await expect(baby.deleteActivityType("custom")).resolves.toBeUndefined();

    expect(JSON.parse(settings.items[0]!.params ?? "{}")).toEqual({ daTypesConfig: "bottle,sleeping" });
    expect((client.firestore.set as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "babyData/babyUid_baby",
      expect.objectContaining({ daTypesConfig: "bottle,sleeping" }),
      { merge: true },
    );
    expect(reminders.items.find((item) => item.uid === "custom-reminder")).toMatchObject({ deleted: true });
    expect(reminders.items.find((item) => item.uid === "bottle-reminder")).not.toMatchObject({ deleted: true });
    expect(groups.items.find((item) => item.uid === "custom-group")).toMatchObject({ deleted: true });
    expect(groups.items.find((item) => item.uid === "bottle-group")).not.toMatchObject({ deleted: true });
    expect(activityRepo.items.find((item) => item.uid === "custom-activity")).toMatchObject({ deleted: true });
    expect(activityRepo.items.find((item) => item.uid === "bottle-activity")).not.toMatchObject({ deleted: true });
    expect(activityTypes.items[0]).toMatchObject({ uid: "custom", deleted: true });

    const saveSettingOrder = settings.save.mock.invocationCallOrder[0]!;
    const saveBabyOrder = (client.firestore.set as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const deleteReminderOrder = reminders.softDelete.mock.invocationCallOrder[0]!;
    const deleteGroupOrder = groups.softDelete.mock.invocationCallOrder[0]!;
    const deleteActivityOrder = activityRepo.softDelete.mock.invocationCallOrder[0]!;
    const deleteTypeOrder = activityTypes.softDelete.mock.invocationCallOrder[0]!;
    expect(saveSettingOrder).toBeLessThan(saveBabyOrder);
    expect(saveBabyOrder).toBeLessThan(deleteReminderOrder);
    expect(deleteReminderOrder).toBeLessThan(deleteGroupOrder);
    expect(deleteGroupOrder).toBeLessThan(deleteActivityOrder);
    expect(deleteActivityOrder).toBeLessThan(deleteTypeOrder);
  });

  it("protects built-in activity types and primary-caregiver ownership", async () => {
    const { baby, client } = configuredBaby();

    await expect(baby.deleteActivityType("bottle")).rejects.toThrow("Default activity type cannot be deleted.");
    expect(client.getBaby).not.toHaveBeenCalled();

    (client as any).getBaby = vi.fn(async () => ({ uid: "baby", userUid: "owner", name: "Baby" }));
    await expect(baby.deleteActivityType("custom")).rejects.toThrow("Only primary caregiver can delete activity type.");
  });

  it("creates native-compatible activity types", async () => {
    const { baby } = configuredBaby();
    const activityTypes = repo<ActivityType>([]);
    (baby as any).activityTypes = activityTypes;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const created = await baby.createActivityType({ uid: "custom", title: "Custom" });

    expect(created).toMatchObject({
      uid: "custom",
      userUid: "user",
      babyUid: "baby",
      title: "Custom",
      icon: "pen_ink",
      color: BABY_DAYBOOK_ACTIVITY_TYPE_COLORS[40],
      category: "",
      hasAmount: false,
      hasDuration: false,
      hasReaction: false,
      updatedMillis: expect.any(Number),
    });
    expect(BABY_DAYBOOK_ACTIVITY_TYPE_COLORS).toHaveLength(80);
    random.mockRestore();
    await expect(baby.createActivityType({ title: "  " })).rejects.toThrow("Activity type title must not be empty");
  });

  it("creates, orders, validates, and deletes groups like the native app", async () => {
    const { baby } = configuredBaby();
    const groups = repo<ActivityGroup>([
      { uid: "sleep", userUid: "user", babyUid: "baby", title: "Night", daType: "sleeping" },
      { uid: "formula", userUid: "user", babyUid: "baby", title: "Formula", daType: "bottle" },
    ]);
    (baby as any).groups = groups;

    await expect(baby.listGroups()).resolves.toEqual([
      expect.objectContaining({ uid: "formula" }),
      expect.objectContaining({ uid: "sleep" }),
    ]);
    await expect(baby.listGroups("bottle")).resolves.toEqual([expect.objectContaining({ uid: "formula" })]);
    await expect(baby.createGroup({ uid: "milk", title: "Milk", daType: "bottle" })).resolves.toMatchObject({
      uid: "milk",
      description: "",
      userUid: "user",
      babyUid: "baby",
      updatedMillis: expect.any(Number),
    });
    await expect(baby.createGroup({ title: "FORMULA", daType: "bottle" })).rejects.toThrow("already exists");
    await expect(baby.hasGroupWithSameName("bottle", "formula", "formula")).resolves.toBe(false);
    await expect(baby.deleteGroup("formula")).resolves.toBeUndefined();
    expect(groups.items.find((group) => group.uid === "formula")).toMatchObject({ deleted: true });
    await expect(baby.deleteGroup("missing")).resolves.toBeUndefined();
  });

  it("gets, updates, recreates, and deletes timezone-keyed daily notes", async () => {
    const { baby } = configuredBaby();
    const notes = repo<DailyNote>([
      { uid: "20260101", userUid: "original", babyUid: "baby", note: "Old note" },
      { uid: "20260102", userUid: "original", babyUid: "baby", note: "Deleted note", deleted: true },
    ]);
    (baby as any).dailyNotes = notes;
    const at = Date.parse("2026-01-02T00:30:00.000Z");

    await expect(baby.getDailyNote(at, "America/Los_Angeles")).resolves.toMatchObject({ uid: "20260101" });
    await expect(baby.getDailyNote(at, "Asia/Tokyo")).resolves.toBeUndefined();
    await expect(baby.setDailyNote("   ", at, "America/Los_Angeles")).resolves.toMatchObject({
      uid: "20260101",
      userUid: "original",
      note: "   ",
      deleted: false,
      updatedMillis: expect.any(Number),
    });
    await expect(baby.setDailyNote("Recreated", at, "Asia/Tokyo")).resolves.toMatchObject({
      uid: "20260102",
      userUid: "original",
      note: "Recreated",
      deleted: false,
    });
    await expect(baby.deleteDailyNote(at, "America/Los_Angeles")).resolves.toBeUndefined();
    expect(notes.items.find((note) => note.uid === "20260101")).toMatchObject({ deleted: true });
    await expect(baby.deleteDailyNote(Date.parse("2026-01-03T12:00:00Z"), "UTC")).resolves.toBeUndefined();
  });

  it("manages attachments, summaries, CSV, and backups", async () => {
    const { baby, client, activityRepo, growthRepo } = configuredBaby();
    const metadata = repo<{ itemUid: string; babyUid: string; fileName: string; deleted?: boolean }>([]);
    const emptyMetadata = repo<{ itemUid: string; babyUid: string; fileName: string; deleted?: boolean }>([]);
    (baby as any).fileMetadata = vi.fn((category: string) => category === "moments" ? metadata : emptyMetadata);
    (client as any).storage = {
      attachmentPath: vi.fn(() => "path"),
      attachmentThumbnailPath: vi.fn(() => "thumb-path"),
      upload: vi.fn(async () => ({})),
      downloadAttachment: vi.fn(async () => new Uint8Array([1, 2])),
      deleteAttachment: vi.fn(async () => undefined),
    };
    activityRepo.items = [activity({ uid: "a", type: "bottle", duration: 100, volume: 60 })];
    growthRepo.items = [{ uid: "g", userUid: "user", babyUid: "baby", dateMillis: 100, weight: 5 }];
    (baby as any).dailyNotes = repo([{ uid: "19700101", userUid: "user", babyUid: "baby", note: "First note" }]);
    (baby as any).activityTypes = repo([{ uid: "bottle", userUid: "user", babyUid: "baby", title: "Bottle feeding" }]);

    await expect(baby.uploadAttachment("moments", "m", "photo.jpg", "image")).resolves.toMatchObject({ itemUid: "m" });
    await expect(baby.downloadAttachment("moments", "m", "photo.jpg")).resolves.toEqual(new Uint8Array([1, 2]));
    await baby.uploadAttachmentThumbnail("moments", "m", "photo.jpg", "thumbnail", "image/jpeg");
    expect((client as any).storage.upload).toHaveBeenLastCalledWith("thumb-path", "thumbnail", "image/jpeg");
    await baby.downloadAttachment("moments", "m", "photo.jpg", true);
    expect((client as any).storage.downloadAttachment).toHaveBeenLastCalledWith("moments", "baby", "m", "photo.jpg", true);
    metadata.items = [{ itemUid: "m", babyUid: "baby", fileName: "photo.jpg" }];
    await baby.deleteAttachment("moments", "m", "photo.jpg");
    expect((client as any).storage.deleteAttachment).toHaveBeenCalledWith("moments", "baby", "m", "photo.jpg");
    metadata.items = [{ itemUid: "m", babyUid: "baby", fileName: "photo.jpg" }];
    await expect(baby.summarizeActivities()).resolves.toMatchObject({ count: 1, totalVolume: 60 });
    await expect(baby.exportActivitiesCsv()).resolves.toContain("bottle");
    const activityPdf = new TextDecoder().decode(await baby.exportActivitiesPdf({ timeZone: "UTC" }));
    expect(activityPdf).toContain("Day note: First note");
    expect(activityPdf).toContain("Bottle feeding");
    await expect(baby.exportGrowthPdf()).resolves.toEqual(expect.any(Uint8Array));
    await expect(baby.exportTimelinePdf()).resolves.toEqual(expect.any(Uint8Array));

    const backup = await baby.createBackup();
    expect(backup).toMatchObject({
      format: "baby-daybook-sdk-backup",
      version: 2,
      baby: { uid: "baby" },
      attachmentsIncluded: true,
      attachments: [{ category: "moments", itemUid: "m", fileName: "photo.jpg", contentType: "image/jpeg", dataBase64: "AQI=" }],
    });
    await baby.restoreBackup(backup);
    expect((client as any).storage.upload).toHaveBeenCalledWith("path", new Uint8Array([1, 2]).buffer, "image/jpeg");
    await expect(baby.createBackup({ includeAttachments: false })).resolves.toMatchObject({ attachmentsIncluded: false, attachments: [] });
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
    const attachmentMetadata = { itemUid: "m", babyUid: "baby", fileName: "photo.jpg" };
    const files = { ...backup.files, moments: [attachmentMetadata] };
    await expect(baby.restoreBackup({ ...backup, files, attachmentsIncluded: true, attachments: [] })).rejects.toThrow("Missing attachment data");
    await expect(baby.restoreBackup({
      ...backup,
      files,
      attachmentsIncluded: true,
      attachments: [{ category: "moments", itemUid: "m", fileName: "photo.jpg", contentType: "image/jpeg", dataBase64: "broken" }],
    })).rejects.toThrow("Invalid base64 attachment data");
  });

  it("exposes the native tooth chart and populated tooth map", async () => {
    const { baby, teethingRepo } = configuredBaby();
    teethingRepo.items = [{
      uid: "central_incisor_lower_left",
      userUid: "user",
      babyUid: "baby",
      name: "central_incisor",
      jaw: "lower",
      side: "left",
      erupted: true,
    }];

    expect(baby.listToothChart()).toHaveLength(10);
    await expect(baby.getToothMap()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: "central_incisor_lower_left", state: "erupted" }),
    ]));
  });

  it("creates, saves, and deletes growth, moment, and tooth records with native sync stamps", async () => {
    const { baby, growthRepo, momentsRepo, teethingRepo } = configuredBaby();
    const now = 1_750_000_000_000;

    const growth = await baby.createGrowth({ uid: "growth", weight: 7.5 }, now);
    expect(growth).toMatchObject({ uid: "growth", dateMillis: now, weight: 7.5, notes: "", updatedMillis: now, svt: 0, deleted: false });
    await expect(baby.deleteGrowth("growth", now + 1)).resolves.toMatchObject({ deleted: true, updatedMillis: now + 1, svt: 0 });

    const moment = await baby.createMoment({ uid: "moment" }, now);
    expect(moment).toMatchObject({ uid: "moment", dateMillis: now, description: "", updatedMillis: now, svt: 0, deleted: false });
    await expect(baby.deleteMoment("moment", now + 1)).resolves.toMatchObject({ deleted: true, updatedMillis: now + 1, svt: 0 });

    const tooth = await baby.createTooth({ name: "canine", jaw: "lower", side: "right" }, now);
    expect(tooth).toMatchObject({ uid: "canine_lower_right", erupted: true, eruptedMillis: now, shed: false, notes: "", updatedMillis: now, svt: 0 });
    await expect(baby.deleteTooth("canine_lower_right", now + 1)).resolves.toMatchObject({ deleted: true, updatedMillis: now + 1, svt: 0 });

    expect(growthRepo.save).toHaveBeenCalledTimes(2);
    expect(momentsRepo.save).toHaveBeenCalledTimes(2);
    expect(teethingRepo.save).toHaveBeenCalledTimes(2);
  });

  it("creates, normalizes, and deletes reminders like the native editor", async () => {
    const { baby, reminderRepo } = configuredBaby();
    const now = 1_750_000_000_000;

    const basic = await baby.createReminder({ daType: "bottle", groupUid: "formula" }, now);
    expect(basic).toMatchObject({
      uid: expect.stringMatching(/^[0-9A-Za-z]{16}$/),
      userUid: "",
      babyUid: "baby",
      daType: "bottle",
      groupUid: "formula",
      type: "basic",
      dateMillis: 0,
      intervalMillis: 10_800_000,
      repeatDays: 0,
      repeatWeekdays: "",
      dndFrom: "",
      dndTo: "",
      dismissedMillis: 0,
      updatedMillis: now,
      svt: 0,
      deleted: false,
    });

    const repeating = await baby.createReminder({
      uid: "repeat",
      daType: "sleeping",
      type: "advanced_repeat_days",
      intervalMillis: 99,
      repeatDays: 0,
      repeatWeekdays: "1,2",
      dndFrom: "22:00",
      dndTo: "07:00",
      dismissedMillis: 55,
    }, now);
    expect(repeating).toMatchObject({
      uid: "repeat",
      dateMillis: now,
      intervalMillis: 0,
      repeatDays: 1,
      repeatWeekdays: "",
      dndFrom: "",
      dndTo: "",
      dismissedMillis: 0,
    });

    await expect(baby.deleteReminder("repeat", now + 1)).resolves.toMatchObject({ deleted: true, updatedMillis: now + 1, svt: 0 });
    await expect(baby.deleteReminder("missing", now + 1)).rejects.toThrow("Reminder missing does not exist");
    expect(reminderRepo.save).toHaveBeenCalledTimes(3);
  });

  it("emits polling changes and stops when aborted", async () => {
    const { baby, client, activityRepo } = configuredBaby();
    activityRepo.items = [activity({ uid: "a" })];
    (baby as any).acceptedInvites = repo([{ babyUid: "baby", userUid: "caregiver" }]);
    (baby as any).pendingInvites = repo([{ babyUid: "baby", userEmailMD5: "hash", userEmail: "care@example.com" }]);
    (baby as any).fileMetadata = vi.fn((category: string) => repo(category === "moments"
      ? [{ itemUid: "moment", babyUid: "baby", fileName: "photo.jpg" }]
      : []));
    (client as any).firestore.get = vi.fn(async (path: string) => ({ data: {
      uid: path.endsWith("caregiver") ? "caregiver" : "user",
      displayName: path.endsWith("caregiver") ? "Caregiver" : "Parent",
    } }));
    (client as any).firestore.list = vi.fn(async (path: string) => path.includes("/purchases")
      ? [{ id: "premium", path: `${path}/premium`, data: { userUid: path.includes("caregiver") ? "caregiver" : "user", productId: "premium" } }]
      : []);
    const controller = new AbortController();
    const iterator = baby.watch({ intervalMillis: 1, signal: controller.signal });
    const first = await iterator.next();
    expect(first.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "baby", id: "baby", type: "added" }),
      expect.objectContaining({ collection: "dailyActions", id: "a", type: "added" }),
      expect.objectContaining({ collection: "momentsFiles", id: "moment", type: "added" }),
      expect.objectContaining({ collection: "acceptedInvites", id: "caregiver", type: "added" }),
      expect.objectContaining({ collection: "pendingInvites", id: "hash", type: "added" }),
      expect.objectContaining({ collection: "caregivers", id: "caregiver", type: "added" }),
      expect.objectContaining({ collection: "caregiversPurchases", id: "caregiver:premium", type: "added" }),
    ]));
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
  const momentsRepo = repo<Moment>([]);
  const teethingRepo = repo<Tooth>([]);
  const reminderRepo = repo<Reminder>([]);
  (baby as any).activityTypes = repo([]);
  (baby as any).activities = activityRepo;
  (baby as any).groups = repo([]);
  (baby as any).growth = growthRepo;
  (baby as any).moments = momentsRepo;
  (baby as any).dailyNotes = repo([]);
  (baby as any).teething = teethingRepo;
  (baby as any).reminders = reminderRepo;
  (baby as any).settings = repo([]);
  (baby as any).acceptedInvites = repo([]);
  (baby as any).pendingInvites = repo([]);
  (baby as any).fileMetadata = vi.fn(() => repo([]));
  return { baby, client, activityRepo, growthRepo, momentsRepo, teethingRepo, reminderRepo };
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
