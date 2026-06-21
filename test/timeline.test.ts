import { describe, expect, it } from "vitest";
import { countActivitiesForRange, listActivitiesForRange } from "../src/index.js";
import type { DailyAction } from "../src/index.js";

describe("native timeline range query", () => {
  it("includes starts in range and duration activities overlapping its start", () => {
    const activities = [
      activity({ uid: "instant-before", type: "bottle", startMillis: 50 }),
      activity({ uid: "ended-before", type: "sleeping", startMillis: 50, endMillis: 99 }),
      activity({ uid: "overlap", type: "sleeping", startMillis: 50, endMillis: 150 }),
      activity({ uid: "active", type: "sleeping", startMillis: 60, inProgress: true }),
      activity({ uid: "inside-b", type: "bottle", startMillis: 150 }),
      activity({ uid: "inside-a", type: "bottle", startMillis: 150 }),
      activity({ uid: "at-end", type: "other", startMillis: 200 }),
      activity({ uid: "after", type: "other", startMillis: 201 }),
      activity({ uid: "deleted", type: "other", startMillis: 175, deleted: true }),
    ];
    const options = { fromMillis: 100, toMillis: 200, nowMillis: 180 };

    expect(listActivitiesForRange(activities, ["sleeping"], options).map((item) => item.uid)).toEqual([
      "at-end",
      "inside-a",
      "inside-b",
      "active",
      "overlap",
    ]);
    expect(countActivitiesForRange(activities, ["sleeping"], options)).toBe(5);
  });

  it("applies native type filtering after overlap selection", () => {
    const activities = [
      activity({ uid: "sleep", type: "sleeping", startMillis: 50, endMillis: 150 }),
      activity({ uid: "feed", type: "bottle", startMillis: 120 }),
    ];
    expect(listActivitiesForRange(activities, ["sleeping"], {
      fromMillis: 100,
      toMillis: 200,
      types: ["bottle"],
    })).toEqual([expect.objectContaining({ uid: "feed" })]);
  });

  it("validates range inputs", () => {
    expect(() => listActivitiesForRange([], [], { fromMillis: 2, toMillis: 1 })).toThrow("start must not be after");
    expect(() => listActivitiesForRange([], [], { fromMillis: 0, toMillis: Number.NaN })).toThrow("boundaries must be finite");
    expect(() => listActivitiesForRange([], [], { fromMillis: 0, toMillis: 1, nowMillis: Number.POSITIVE_INFINITY })).toThrow("time must be finite");
  });
});

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "activity", userUid: "user", babyUid: "baby", type: "other", startMillis: 0, ...update };
}
