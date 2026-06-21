import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ACTIVITY_TYPES,
  createDefaultActivityGroups,
  createDefaultActivityTypes,
  DEFAULT_ACTIVITY_GROUP_DEFINITIONS,
  DEFAULT_ACTIVITY_TYPE_DEFINITIONS,
} from "../src/index.js";

describe("native baby defaults", () => {
  it("defines every native built-in activity type in native order", () => {
    expect(DEFAULT_ACTIVITY_TYPE_DEFINITIONS.map(({ uid }) => uid)).toEqual(BUILT_IN_ACTIVITY_TYPES);
    expect(createDefaultActivityTypes("baby", 123)).toHaveLength(20);
    expect(createDefaultActivityTypes("baby", 123).find(({ uid }) => uid === "other")).toEqual({
      uid: "other",
      babyUid: "baby",
      userUid: "",
      updatedMillis: 123,
      title: "",
      color: "#765547",
      icon: "pen_ink",
      category: "",
      hasDuration: false,
      hasAmount: true,
      hasReaction: true,
    });
  });

  it("creates all native default groups with independent native-format ids", () => {
    expect(DEFAULT_ACTIVITY_GROUP_DEFINITIONS).toHaveLength(39);
    const groups = createDefaultActivityGroups("baby", 456);
    expect(groups).toHaveLength(39);
    expect(new Set(groups.map(({ uid }) => uid)).size).toBe(39);
    expect(groups.every(({ uid }) => /^[0-9A-Za-z]{16}$/.test(uid))).toBe(true);
    expect(groups.at(-1)).toMatchObject({
      babyUid: "baby",
      userUid: "",
      updatedMillis: 456,
      title: "Decreased appetite",
      description: "",
      daType: "symptom",
    });
  });
});
