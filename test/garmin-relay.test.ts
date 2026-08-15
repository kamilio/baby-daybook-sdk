import { describe, expect, it, vi } from "vitest";
import { AuthSession, FirestoreClient } from "../src/index.js";
import { applyGarminEvents, buildGarminEventDocument, createGarminEventsIfAbsent, garminBabyProfile, inferBottleMessageKey, latestActiveSleep, latestEventMillis, validateSyncRequest } from "../src/garmin-relay.js";
import { jsonResponse, mockFetch } from "./helpers.js";

describe("Garmin relay validation", () => {
  it("derives canonical keys when native default bottle groups omit messageKey", () => {
    expect(inferBottleMessageKey("Mother’s milk")).toBe("mothers_milk");
    expect(inferBottleMessageKey("Formula")).toBe("formula");
  });
  it("accepts the bounded watch event schema", () => {
    const request = validateSyncRequest({
      refreshToken: "refresh-token",
      babyUid: "victoria_1",
      client: { appVersion: "0.21.0-beta.1", internalVersion: 21, authPrefix: "AMf-vBy-" },
      events: [
        { id: "event-1", type: "bottle", startMillis: 1234, volume: 120 },
        { id: "event-2", type: "diaper_change", startMillis: 1235, pee: true, poo: false },
      ],
    });
    expect(request.events).toHaveLength(2);
    expect(request.client).toEqual({ appVersion: "0.21.0-beta.1", internalVersion: 21, authPrefix: "AMf-vBy-" });
  });

  it("accepts legacy requests without client metadata and rejects malformed versions", () => {
    expect(validateSyncRequest({ refreshToken: "token", babyUid: "baby", events: [] }).client).toBeNull();
    expect(() => validateSyncRequest({
      refreshToken: "token", babyUid: "baby", events: [],
      client: { appVersion: "<secret>", internalVersion: 21, authPrefix: "token" },
    })).toThrow();
  });

  it.each([
    {},
    { refreshToken: "token", babyUid: "bad/uid", events: [{ id: "a", type: "bottle", startMillis: 1 }] },
    { refreshToken: "token", babyUid: "baby", events: [{ id: "bad/id", type: "bottle", startMillis: 1 }] },
    { refreshToken: "token", babyUid: "baby", events: [{ id: "a", type: "other", startMillis: 1 }] },
    { refreshToken: "token", babyUid: "baby", events: [{ id: "a", type: "bottle", startMillis: 1, volume: -1 }] },
  ])("rejects malformed payload %#", (payload) => {
    expect(() => validateSyncRequest(payload)).toThrow();
  });

  it("rejects duplicate event IDs", () => {
    expect(() => validateSyncRequest({
      refreshToken: "token",
      babyUid: "baby",
      events: [
        { id: "same", type: "bottle", startMillis: 1 },
        { id: "same", type: "bottle", startMillis: 2 },
      ],
    })).toThrow();
  });

  it("accepts an empty event list for pull-only sync", () => {
    expect(validateSyncRequest({ refreshToken: "token", babyUid: "baby", events: [] }).events).toEqual([]);
  });

  it("accepts fetched bottle-group selection and Homey-compatible sleep transitions", () => {
    const events = validateSyncRequest({
      refreshToken: "token", babyUid: "baby", events: [
        { id: "bottle", type: "bottle", startMillis: 1, volume: 120, bottleGroupUid: "formula-uid", milkType: "formula" },
        { id: "sleep-start", type: "sleeping", startMillis: 2, inProgress: true },
        { id: "sleep-stop", type: "sleeping", activityId: "sleep-start", startMillis: 2, endMillis: 12, duration: 10, inProgress: false },
      ],
    }).events;
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ bottleGroupUid: "formula-uid", milkType: "formula" });
    expect(events[2]).toMatchObject({ activityId: "sleep-start", duration: 10, inProgress: false });
  });

  it("finds latest upstream events from ordered pages", async () => {
    const listPage = vi.fn()
      .mockResolvedValueOnce({ documents: [
        { data: { type: "bottle", startMillis: 300 } },
        { data: { type: "diaper_change", startMillis: 250, pee: 1, poo: 0 } },
      ], nextPageToken: "next" })
      .mockResolvedValueOnce({ documents: [
        { data: { type: "diaper_change", startMillis: 200, pee: 0, poo: 1 } },
      ] });
    await expect(latestEventMillis({ listPage } as any, "baby")).resolves.toEqual({ bottle: 300, wet: 250, dirty: 200 });
    expect(listPage).toHaveBeenCalledTimes(2);
  });

  it("finds the newest active non-deleted sleep", async () => {
    const listPage = vi.fn().mockResolvedValue({ documents: [
      { id: "stopped", data: { uid: "stopped", type: "sleeping", startMillis: 300, inProgress: 0 } },
      { id: "deleted", data: { uid: "deleted", type: "sleeping", startMillis: 250, inProgress: 1, deleted: 1 } },
      { id: "active", data: { uid: "active", type: "sleeping", startMillis: 200, inProgress: 1 } },
    ] });
    await expect(latestActiveSleep({ listPage } as any, "baby")).resolves.toEqual({ activityId: "active", startMillis: 200 });
  });

  it("returns the baby identity needed by the Garmin glance", async () => {
    const get = vi.fn().mockResolvedValue({ data: { name: " Victoria ", birthdayMillis: 1786049460000 } });
    await expect(garminBabyProfile({ get } as any, "victoria"))
      .resolves.toEqual({ name: "Victoria", birthdayMillis: 1786049460000 });
    expect(get).toHaveBeenCalledWith("babyData/babyUid_victoria");
  });

  it("uses safe glance fallbacks for an incomplete baby profile", async () => {
    await expect(garminBabyProfile({ get: vi.fn().mockResolvedValue({ data: {} }) } as any, "baby"))
      .resolves.toEqual({ name: "Baby", birthdayMillis: null });
  });

  it("creates native records once, forces bottle volume to double, and accepts retry conflicts", async () => {
    const events = [
      { id: "new", type: "bottle" as const, startMillis: 1, volume: 120 },
      { id: "edited", type: "diaper_change" as const, startMillis: 2, pee: true, poo: false },
      { id: "deleted", type: "bottle" as const, startMillis: 3, volume: 90 },
    ];
    const fetch = mockFetch((url, init) => {
      expect(url.endsWith("documents:batchWrite")).toBe(true);
      const body = JSON.parse(String(init?.body));
      expect(body.writes).toHaveLength(3);
      expect(body.writes.every((write: any) => write.currentDocument?.exists === false)).toBe(true);
      expect(body.writes.every((write: any) => write.updateTransforms?.[0]?.fieldPath === "svt")).toBe(true);
      expect(body.writes[0]).toMatchObject({
        update: {
          name: "projects/baby-daybook-app/databases/(default)/documents/babyData/babyUid_baby/dailyActions/new",
          fields: {
            rev: { integerValue: "4" },
            volume: { doubleValue: 120 },
            inProgress: { integerValue: "0" },
            pee: { integerValue: "0" },
            poo: { integerValue: "0" },
          },
        },
      });
      expect(body.writes[1].update.fields).toMatchObject({
        volume: { doubleValue: 0 },
        pee: { integerValue: "1" },
        poo: { integerValue: "0" },
      });
      return jsonResponse({
        status: [
          {},
          { code: 6, message: "A phone-edited record already exists" },
          { code: 6, message: "A deletion tombstone won the race" },
        ],
      });
    });
    const firestore = new FirestoreClient(new AuthSession({
      idToken: "id-token",
      userId: "user",
      expiresAt: Date.now() + 3_600_000,
    }, { fetch }));

    await expect(createGarminEventsIfAbsent(firestore, "baby", "user", events, 10, "milk"))
      .resolves.toEqual([true, false, false]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("builds the complete native revision-4 activity shape", () => {
    expect(buildGarminEventDocument(
      { id: "event-1", type: "diaper_change", startMillis: 1234, pee: true, poo: false },
      "user-1",
      "baby-1",
      5678,
    )).toEqual(expect.objectContaining({
      uid: "event-1",
      rev: 4,
      groupUid: "",
      notes: "",
      inProgress: 0,
      duration: 0,
      volume: 0,
      pee: 1,
      poo: 0,
    }));
    expect(buildGarminEventDocument(
      { id: "event-2", type: "bottle", startMillis: 1234, volume: 120 },
      "user-1",
      "baby-1",
      5678,
      "milk-1",
    )).toEqual(expect.objectContaining({ groupUid: "milk-1", volume: 120, pee: 0, poo: 0 }));
    expect(buildGarminEventDocument(
      { id: "stop-op", activityId: "sleep-1", type: "sleeping", startMillis: 100, endMillis: 250, duration: 150, inProgress: false },
      "user-1", "baby-1", 5678,
    )).toEqual(expect.objectContaining({ uid: "sleep-1", type: "sleeping", startMillis: 100, endMillis: 250, duration: 150, inProgress: 0 }));
  });

  it("uses fetched bottle group IDs and updates the original sleep document on stop", async () => {
    const set = vi.fn().mockResolvedValue({});
    await applyGarminEvents({ list: vi.fn().mockResolvedValue([]), set } as any, "baby", "user", [
      { id: "bottle", type: "bottle", startMillis: 1, bottleGroupUid: "formula" },
      { id: "stop-op", activityId: "sleep-1", type: "sleeping", startMillis: 2, endMillis: 12, duration: 10, inProgress: false },
    ], 20, [
      { uid: "mother", title: "Mother’s milk", messageKey: "mothers_milk" },
      { uid: "formula", title: "Formula", messageKey: "formula" },
    ]);
    expect(set).toHaveBeenCalledWith(
      "babyData/babyUid_baby/dailyActions/bottle",
      expect.objectContaining({ groupUid: "formula" }),
      { doubleFields: ["volume"] },
    );
    expect(set).toHaveBeenCalledWith(
      "babyData/babyUid_baby/dailyActions/sleep-1",
      expect.objectContaining({ uid: "sleep-1", inProgress: 0, duration: 10 }),
      { doubleFields: ["volume"] },
    );
  });

  it("does not silently substitute a different fetched bottle group", async () => {
    await expect(applyGarminEvents({ list: vi.fn().mockResolvedValue([]), set: vi.fn() } as any, "baby", "user", [
      { id: "bottle", type: "bottle", startMillis: 1, bottleGroupUid: "missing" },
    ], 20, [{ uid: "mother", title: "Mother’s milk", messageKey: "mothers_milk" }])).rejects.toThrow();
  });

  it("merges complementary Garmin diaper events within one minute", async () => {
    const set = vi.fn().mockResolvedValue({});
    const list = vi.fn().mockResolvedValue([{
      id: "wet-event",
      path: "babyData/babyUid_baby/dailyActions/wet-event",
      data: { uid: "wet-event", type: "diaper_change", startMillis: 100_000, pee: 1, poo: 0, volume: 0 },
    }]);

    await applyGarminEvents({ list, set } as any, "baby", "user", [
      { id: "dirty-event", type: "diaper_change", startMillis: 160_000, pee: false, poo: true },
    ], 200_000, []);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      "babyData/babyUid_baby/dailyActions/wet-event",
      expect.objectContaining({ uid: "wet-event", startMillis: 100_000, pee: 1, poo: 1, updatedMillis: 200_000 }),
      { doubleFields: ["volume"] },
    );
  });

  it("keeps Garmin diaper events separate when over one minute apart", async () => {
    const set = vi.fn().mockResolvedValue({});
    const list = vi.fn().mockResolvedValue([{
      id: "wet-event",
      path: "babyData/babyUid_baby/dailyActions/wet-event",
      data: { uid: "wet-event", type: "diaper_change", startMillis: 100_000, pee: 1, poo: 0 },
    }]);

    await applyGarminEvents({ list, set } as any, "baby", "user", [
      { id: "dirty-event", type: "diaper_change", startMillis: 160_001, pee: false, poo: true },
    ], 200_000, []);

    expect(set).toHaveBeenCalledWith(
      "babyData/babyUid_baby/dailyActions/dirty-event",
      expect.objectContaining({ uid: "dirty-event", pee: 0, poo: 1 }),
      { doubleFields: ["volume"] },
    );
  });
});
