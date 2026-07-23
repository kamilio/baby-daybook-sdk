import { describe, expect, it, vi } from "vitest";
import { ActivityTypeRepository } from "../src/activity-types.js";
import {
  resolveActivityTypeDisplayTitle,
  withActivityTypeDisplayTitle,
} from "../src/index.js";
import type { ActivityType, FirestoreClient } from "../src/index.js";

describe("activity type display titles", () => {
  it("resolves blank native built-in titles without changing stored data", () => {
    const activityType = type({ uid: "bottle", title: "" });

    expect(resolveActivityTypeDisplayTitle(activityType)).toBe("Bottle");
    expect(withActivityTypeDisplayTitle(activityType)).toEqual({
      ...activityType,
      displayTitle: "Bottle",
    });
    expect(activityType.title).toBe("");
  });

  it("prefers a trimmed stored title for custom and renamed types", () => {
    expect(resolveActivityTypeDisplayTitle(type({ uid: "custom", title: "  Medicine time  " }))).toBe("Medicine time");
  });

  it("falls back to the UID for an unknown blank type", () => {
    expect(resolveActivityTypeDisplayTitle(type({ uid: "custom_uid", title: "  " }))).toBe("custom_uid");
    expect(resolveActivityTypeDisplayTitle("custom_uid")).toBe("custom_uid");
    expect(resolveActivityTypeDisplayTitle({ uid: "deleted_tombstone" })).toBe("deleted_tombstone");
    expect(resolveActivityTypeDisplayTitle("toString")).toBe("toString");
  });

  it("never persists a presentation-only display title", async () => {
    const set = vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data }));
    const repository = new ActivityTypeRepository({ set } as unknown as FirestoreClient, "babies/baby/daTypes");
    const activityType = type({ uid: "bottle", title: "" });

    await repository.save(withActivityTypeDisplayTitle(activityType));

    expect(set.mock.calls[0]?.[1]).toEqual(activityType);
    expect(set.mock.calls[0]?.[1]).not.toHaveProperty("displayTitle");
  });

  it("normalizes native capability flags and persists integer flags", async () => {
    const set = vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data }));
    const repository = new ActivityTypeRepository({ set } as unknown as FirestoreClient, "babies/baby/daTypes");
    const native = type({ hasDuration: 1, hasAmount: 0, hasReaction: 1 } as unknown as Partial<ActivityType>);

    const saved = await repository.save(native);

    expect(set.mock.calls[0]?.[1]).toMatchObject({ hasDuration: 1, hasAmount: 0, hasReaction: 1 });
    expect(saved).toMatchObject({ hasDuration: true, hasAmount: false, hasReaction: true });

    await repository.save(type({ hasAmount: undefined }));
    expect(Object.hasOwn(set.mock.calls[1]![1], "hasAmount")).toBe(true);
    expect(set.mock.calls[1]![1].hasAmount).toBeUndefined();
  });
});

function type(update: Partial<ActivityType>): ActivityType {
  return { uid: "custom", userUid: "user", babyUid: "baby", title: "", ...update };
}
