import { describe, expect, it } from "vitest";
import { validateSyncRequest } from "../src/garmin-relay.js";

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
    { refreshToken: "token", babyUid: "baby", events: [] },
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
});
