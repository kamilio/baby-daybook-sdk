import { describe, expect, it } from "vitest";
import { buildStatisticsScreenData, getStatisticsTabDataTypes } from "../src/index.js";
import type { ActivityType, DailyAction } from "../src/index.js";

describe("native statistics screen data", () => {
  it("returns tabs in native eligibility order", () => {
    expect(getStatisticsTabDataTypes(type("other"))).toEqual(["numberOfTimes", "timeOfDay"]);
    expect(getStatisticsTabDataTypes(type("sleeping", { hasDuration: true }))).toEqual([
      "numberOfTimes", "duration", "timeOfDay",
    ]);
    expect(getStatisticsTabDataTypes(type("temperature", { hasAmount: true, hasReaction: true }))).toEqual([
      "numberOfTimes", "temperature", "amount", "reaction", "timeOfDay",
    ]);
    expect(getStatisticsTabDataTypes(type("pump", { hasDuration: true, hasAmount: true, hasReaction: true }))).toEqual([
      "numberOfTimes", "duration", "volume", "amount", "reaction", "timeOfDay",
    ]);
  });

  it("uses configured type order, active record counts, and preferred selection", () => {
    const data = buildStatisticsScreenData(
      [type("sleeping", { hasDuration: true }), type("bottle"), type("hidden", { deleted: true })],
      [
        activity({ uid: "sleep-a", type: "sleeping" }),
        activity({ uid: "sleep-b", type: "sleeping", deleted: true }),
        activity({ uid: "feed-a", type: "bottle" }),
        activity({ uid: "feed-b", type: "bottle" }),
        activity({ uid: "unknown", type: "missing" }),
      ],
      ["bottle", "missing", "sleeping", "bottle", "hidden"],
      "sleeping",
    );
    expect(data.items).toEqual([
      expect.objectContaining({ activityType: expect.objectContaining({ uid: "bottle" }), activityCount: 2 }),
      expect.objectContaining({ activityType: expect.objectContaining({ uid: "sleeping" }), activityCount: 1 }),
    ]);
    expect(data.selectedItem?.activityType.uid).toBe("sleeping");
  });

  it("falls back to the first type and supports an empty selector", () => {
    const first = buildStatisticsScreenData([type("bottle"), type("sleeping")], [], [], "missing");
    expect(first.selectedItem?.activityType.uid).toBe("bottle");
    expect(buildStatisticsScreenData([], []).selectedItem).toBeUndefined();
  });

  it("adds a display title while preserving a native blank title", () => {
    const data = buildStatisticsScreenData([type("sleeping", { title: "" })], []);

    expect(data.selectedItem?.activityType).toMatchObject({ title: "", displayTitle: "Sleep" });
  });
});

function type(uid: string, update: Partial<ActivityType> = {}): ActivityType {
  return { uid, userUid: "user", babyUid: "baby", title: uid, ...update };
}

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "activity", userUid: "user", babyUid: "baby", type: "other", startMillis: 0, ...update };
}
