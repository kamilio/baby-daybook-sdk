import { describe, expect, it } from "vitest";
import { buildDayActivityTypeSummaries } from "../src/index.js";
import type { ActivityGroup, ActivityType, DailyAction } from "../src/index.js";

describe("native home day activity summaries", () => {
  it("aggregates native per-type fields and orders cards by latest activity", () => {
    const summaries = buildDayActivityTypeSummaries(
      [
        type("sleeping", { hasDuration: true }),
        type("bottle"),
        type("diaper_change"),
        type("bath"),
        type("temperature"),
        type("food", { hasAmount: true }),
      ],
      [
        activity({ uid: "sleep", type: "sleeping", startMillis: 50, endMillis: 150, duration: 100 }),
        activity({ uid: "bottle", type: "bottle", startMillis: 190, groupUid: "milk", volume: 120 }),
        activity({ uid: "diaper", type: "diaper_change", startMillis: 180, pee: true, poo: true }),
        activity({ uid: "bath", type: "bath", startMillis: 170, hairWash: true }),
        activity({ uid: "temp-a", type: "temperature", startMillis: 160, temperature: 37.2 }),
        activity({ uid: "temp-b", type: "temperature", startMillis: 150, temperature: 38.1 }),
        activity({ uid: "food-a", type: "food", startMillis: 140, groupUid: "fruit", amount: 2, amountUnit: "tbsp" }),
        activity({ uid: "food-b", type: "food", startMillis: 130, groupUid: "fruit", amount: 3, amountUnit: "tbsp" }),
      ],
      [group("milk", "Milk"), group("fruit", "Fruit")],
      { fromMillis: 100, toMillis: 200, nowMillis: 200 },
    );

    expect(summaries.map((summary) => summary.activityType.uid)).toEqual([
      "bottle", "diaper_change", "bath", "temperature", "food", "sleeping",
    ]);
    expect(summaries.find((summary) => summary.activityType.uid === "sleeping")).toMatchObject({
      activityCount: 0,
      durationMillis: 50,
    });
    expect(summaries.find((summary) => summary.activityType.uid === "bottle")).toMatchObject({
      activityCount: 1,
      volume: 120,
      lastGroupUid: "milk",
      lastGroupTitle: "Milk",
      amountByGroup: [{ groupUid: "milk", groupTitle: "Milk", amount: 120, count: 1 }],
    });
    expect(summaries.find((summary) => summary.activityType.uid === "diaper_change")).toMatchObject({ peeCount: 1, pooCount: 1 });
    expect(summaries.find((summary) => summary.activityType.uid === "bath")).toMatchObject({ hairWashCount: 1 });
    expect(summaries.find((summary) => summary.activityType.uid === "temperature")).toMatchObject({ maxTemperature: 38.1 });
    expect(summaries.find((summary) => summary.activityType.uid === "food")).toMatchObject({
      amountByGroup: [{ groupUid: "fruit", groupTitle: "Fruit", amountUnit: "tbsp", amount: 5, count: 2 }],
      amountByUnit: [{ amountUnit: "tbsp", amount: 5, count: 2 }],
      lastAmountUnit: "tbsp",
    });
  });

  it("matches native completed and running left/right rules", () => {
    const summaries = buildDayActivityTypeSummaries(
      [type("pump", { hasDuration: true })],
      [
        activity({
          uid: "running",
          type: "pump",
          startMillis: 200,
          inProgress: true,
          side: "right",
          leftDuration: 40,
          rightDuration: 20,
          volume: 30,
        }),
        activity({
          uid: "complete",
          type: "pump",
          startMillis: 100,
          endMillis: 180,
          side: "left",
          leftDuration: 50,
          rightDuration: 30,
          volume: 20,
        }),
      ],
      [],
      { fromMillis: 0, toMillis: 300, nowMillis: 260 },
    );

    expect(summaries[0]).toMatchObject({
      activityCount: 2,
      leftDurationMillis: 90,
      rightDurationMillis: 30,
      volume: 50,
      leftVolume: 20,
      rightVolume: 30,
      lastSide: "right",
      inProgressActivity: { uid: "running" },
    });
  });

  it("uses configured cards, skips unknown entries, and keeps empty summaries", () => {
    const summaries = buildDayActivityTypeSummaries(
      [type("bottle"), type("bath"), type("food", { hasAmount: true })],
      [activity({ uid: "food", type: "food", startMillis: 150, amount: 1, amountUnit: "oz" })],
      [],
      { fromMillis: 100, toMillis: 200 },
      ["bath", "missing", "food", "bath"],
    );
    expect(summaries.map((summary) => summary.activityType.uid)).toEqual(["food", "bath"]);
    expect(summaries[1]).toMatchObject({ activityCount: 0, durationMillis: 0, amountByGroup: [] });
  });

  it("does not report today's running generic duration beside its in-progress card", () => {
    const dayStart = new Date(2026, 6, 6).getTime();
    const [summary] = buildDayActivityTypeSummaries(
      [type("sleeping", { hasDuration: true })],
      [activity({ uid: "active", type: "sleeping", startMillis: dayStart + 100, inProgress: true })],
      [],
      { fromMillis: dayStart, toMillis: dayStart + 500, nowMillis: dayStart + 10_000 },
    );
    expect(summary).toMatchObject({ activityCount: 1, durationMillis: 0, inProgressActivity: { uid: "active" } });
  });

  it("adds a display title while preserving a native blank title", () => {
    const summary = buildDayActivityTypeSummaries(
      [type("bottle", { title: "" })],
      [],
      [],
      { fromMillis: 0, toMillis: 1 },
    )[0]!;

    expect(summary.activityType).toMatchObject({ uid: "bottle", title: "", displayTitle: "Bottle" });
  });
});

function type(uid: string, update: Partial<ActivityType> = {}): ActivityType {
  return { uid, userUid: "user", babyUid: "baby", title: uid, ...update };
}

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "activity", userUid: "user", babyUid: "baby", type: "other", startMillis: 0, ...update };
}

function group(uid: string, title: string): ActivityGroup {
  return { uid, userUid: "user", babyUid: "baby", title };
}
