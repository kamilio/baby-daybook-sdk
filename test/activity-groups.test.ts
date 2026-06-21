import { describe, expect, it } from "vitest";
import { hasActivityGroupWithSameName, sortActivityGroups } from "../src/activity-groups.js";
import type { ActivityGroup } from "../src/types.js";

describe("activity groups", () => {
  it("uses native activity-type and case-insensitive title ordering", () => {
    const groups = sortActivityGroups([
      group({ uid: "sleep-z", daType: "sleeping", title: "Zebra" }),
      group({ uid: "bottle-z", daType: "bottle", title: "zebra" }),
      group({ uid: "bottle-a", daType: "bottle", title: "Apple" }),
      group({ uid: "deleted", daType: "bottle", title: "Before", deleted: true }),
    ]);

    expect(groups.map((item) => item.uid)).toEqual(["bottle-a", "bottle-z", "sleep-z"]);
  });

  it("matches duplicate names case-insensitively within one activity type", () => {
    const groups = [
      group({ uid: "formula", daType: "bottle", title: "Formula" }),
      group({ uid: "deleted", daType: "bottle", title: "Milk", deleted: true }),
    ];

    expect(hasActivityGroupWithSameName(groups, "bottle", "FORMULA")).toBe(true);
    expect(hasActivityGroupWithSameName(groups, "bottle", "formula", "formula")).toBe(false);
    expect(hasActivityGroupWithSameName(groups, "food", "Formula")).toBe(false);
    expect(hasActivityGroupWithSameName(groups, "bottle", "Milk")).toBe(false);
  });
});

function group(update: Partial<ActivityGroup>): ActivityGroup {
  return { uid: "group", userUid: "user", babyUid: "baby", title: "Group", ...update };
}
