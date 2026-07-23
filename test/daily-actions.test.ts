import { describe, expect, it, vi } from "vitest";
import {
  buildPointActivity,
  decodeDailyAction,
  encodeDailyAction,
  getInProgressActivities,
  matchesStatisticsActivityParameter,
} from "../src/index.js";
import { DailyActionRepository } from "../src/daily-actions.js";
import type { DailyAction, FirestoreClient } from "../src/index.js";

describe("native daily action records", () => {
  it("builds a complete native revision-4 point activity", () => {
    const activity = buildPointActivity({
      type: "pump",
      startMillis: 100,
      volume: 120,
      side: "both",
    }, { userUid: "user", babyUid: "baby", updatedMillis: 200 });

    expect(activity).toMatchObject({
      userUid: "user",
      babyUid: "baby",
      type: "pump",
      startMillis: 100,
      updatedMillis: 200,
      rev: 4,
      volume: 120,
      side: "both",
      inProgress: false,
      pee: false,
      poo: false,
      hairWash: false,
      endMillis: 0,
      duration: 0,
    });
    expect(activity.uid).toMatch(/^[0-9A-Za-z]{32}$/);
  });

  it("normalizes native integer flags and writes them back as integers", () => {
    const native = action({ inProgress: 1, pee: 1, poo: 0, hairWash: 0 } as unknown as Partial<DailyAction>);
    const decoded = decodeDailyAction(native);

    expect(decoded).toMatchObject({ inProgress: true, pee: true, poo: false, hairWash: false });
    expect(encodeDailyAction(decoded)).toMatchObject({ inProgress: 1, pee: 1, poo: 0, hairWash: 0 });
    expect(getInProgressActivities([native])).toHaveLength(1);
    expect(matchesStatisticsActivityParameter(native, "wet")).toBe(true);
    expect(matchesStatisticsActivityParameter(native, "dirty")).toBe(false);
  });

  it("applies the flag codec at the repository write boundary", async () => {
    const set = vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data }));
    const repository = new DailyActionRepository({ set } as unknown as FirestoreClient, "babies/baby/dailyActions");

    const saved = await repository.save(action({ inProgress: false, pee: true, poo: false }));

    expect(set.mock.calls[0]?.[1]).toMatchObject({ inProgress: 0, pee: 1, poo: 0 });
    expect(saved).toMatchObject({ inProgress: false, pee: true, poo: false });

    await repository.save(action({ pee: undefined }));
    expect(Object.hasOwn(set.mock.calls[1]![1], "pee")).toBe(true);
    expect(set.mock.calls[1]![1].pee).toBeUndefined();
  });

  it.each([null, 2, "true"])("rejects invalid native daily-action flags (%j)", (value) => {
    const invalid = action({ pee: value } as unknown as Partial<DailyAction>);

    expect(() => decodeDailyAction(invalid)).toThrow(/native boolean flag/i);
    expect(() => encodeDailyAction(invalid)).toThrow(/native boolean flag/i);
  });
});

function action(update: Partial<DailyAction> = {}): DailyAction {
  return { uid: "activity", userUid: "user", babyUid: "baby", type: "diaper_change", startMillis: 100, ...update };
}
