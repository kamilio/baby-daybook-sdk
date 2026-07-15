import { describe, expect, it, vi } from "vitest";
import { buildGarminEventDocument, eventsNotDeletedUpstream, latestEventMillis, validateSyncRequest } from "../src/garmin-relay.js";

describe("Garmin relay validation", () => {
  it("accepts the bounded watch event schema", () => {
    expect(validateSyncRequest({
      refreshToken: "refresh-token",
      babyUid: "victoria_1",
      events: [
        { id: "event-1", type: "bottle", startMillis: 1234, volume: 120 },
        { id: "event-2", type: "diaper_change", startMillis: 1235, pee: true, poo: false },
      ],
    }).events).toHaveLength(2);
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

  it("lets upstream deletion win over a stale queued watch event", async () => {
    const events = [
      { id: "deleted", type: "bottle" as const, startMillis: 1, volume: 120 },
      { id: "new", type: "diaper_change" as const, startMillis: 2, pee: true, poo: false },
    ];
    const get = vi.fn()
      .mockResolvedValueOnce({ data: { deleted: true } })
      .mockResolvedValueOnce(undefined);
    await expect(eventsNotDeletedUpstream({ get } as any, "baby", events)).resolves.toEqual([events[1]]);
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
  });
});
