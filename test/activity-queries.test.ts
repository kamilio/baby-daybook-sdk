import { describe, expect, it } from "vitest";
import {
  BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS,
  findOverlappingActivities,
  getInProgressActivities,
  getLastActivities,
  getLastActivity,
  getLastAmountForGroup,
} from "../src/activity-queries.js";
import type { DailyAction } from "../src/types.js";

describe("Baby Daybook native activity queries", () => {
  const now = 1_000_000;
  const activities = [
    action({ uid: "old-bottle", type: "bottle", startMillis: 100, groupUid: "formula", amount: 90, amountUnit: "ml" }),
    action({ uid: "new-bottle", type: "bottle", startMillis: 900_000, groupUid: "formula", amount: 120, amountUnit: "ml" }),
    action({ uid: "future-grace", type: "sleeping", startMillis: now + BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS }),
    action({ uid: "future-outside", type: "food", startMillis: now + BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS + 1 }),
    action({ uid: "active-old", type: "sleeping", startMillis: 700_000, inProgress: true }),
    action({ uid: "active-new", type: "sleeping", startMillis: 800_000, inProgress: true }),
    action({ uid: "deleted", type: "bottle", startMillis: 950_000, deleted: true }),
  ];

  it("matches single and grouped last-activity selection", () => {
    expect(getLastActivity(activities, "bottle", { atMillis: now })?.uid).toBe("new-bottle");
    expect(getLastActivity(activities, "bottle", { groupUid: "formula", atMillis: now })?.uid).toBe("new-bottle");
    expect(getLastActivity(activities, "sleeping", { atMillis: now })?.uid).toBe("future-grace");
    expect(getLastActivity(activities, "food", { atMillis: now })).toBeUndefined();
  });

  it("returns the latest item per requested type", () => {
    expect(getLastActivities(activities, ["bottle", "sleeping", "food"], now).map((item) => item.uid)).toEqual([
      "new-bottle",
      "active-new",
    ]);
  });

  it("returns only the newest in-progress item per type", () => {
    expect(getInProgressActivities(activities).map((item) => item.uid)).toEqual(["active-new"]);
  });

  it("matches native overlap boundaries and open timers", () => {
    const existing = [
      action({ uid: "touch-start", startMillis: 200, endMillis: 300 }),
      action({ uid: "spans", startMillis: 50, endMillis: 150 }),
      action({ uid: "open", startMillis: 25, inProgress: true }),
      action({ uid: "touch-end", startMillis: 100, endMillis: 150 }),
      action({ uid: "other", type: "sleeping", startMillis: 120, endMillis: 180 }),
    ];
    const candidate = action({ uid: "candidate", startMillis: 100, endMillis: 200 });
    expect(findOverlappingActivities(existing, candidate).map((item) => item.uid)).toEqual(["touch-start", "spans", "open", "touch-end"]);
  });

  it("inherits the latest amount and unit for a group", () => {
    expect(getLastAmountForGroup(activities, "bottle", "formula")).toEqual({ amount: 120, amountUnit: "ml" });
    expect(getLastAmountForGroup([
      action({ uid: "b", startMillis: 100, groupUid: "formula", amount: 200 }),
      action({ uid: "a", startMillis: 100, groupUid: "formula", amount: 100 }),
    ], "bottle", "formula")).toEqual({ amount: 100, amountUnit: undefined });
    expect(getLastAmountForGroup(activities, "bottle", "missing")).toBeUndefined();
  });
});

function action(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "user", babyUid: "baby", type: "bottle", startMillis: 0, ...update };
}
