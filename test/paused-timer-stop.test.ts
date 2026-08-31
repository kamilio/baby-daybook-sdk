import { describe, expect, it, vi } from "vitest";
import { BabyDaybookClient } from "../src/index.js";
import { sideTimerStore, timerCollection } from "./side-timer-helpers.js";

const MINUTE = 60_000;
const START = new Date(2026, 7, 31, 12).getTime();
const FROM = new Date(2026, 7, 31).getTime();
const TO = new Date(2026, 8, 1).getTime() - 1;

function fixture(type = "sleeping") {
  const store = sideTimerStore(type);
  const client = new BabyDaybookClient({
    session: { idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 }, fetch: store.fetch,
  });
  const baby = client.baby("baby");
  const summary = async () => (await baby.getDayActivityTypeSummaries({ fromMillis: FROM, toMillis: TO, nowMillis: START + 60 * MINUTE }))[0]!;
  return { baby, store, summary };
}

describe("stopping paused timers", () => {
  for (const type of ["sleeping", "breastfeeding", "pump", "custom-timer"]) {
    it(`ends a paused ${type} at the pause boundary in one completion write`, async () => {
      const { baby, store, summary } = fixture(type);
      await baby.startActivity({ uid: "timer", type, startMillis: START, side: "left", notes: "Keep me", groupUid: "group" });
      await baby.pauseActivity("timer", START + 10 * MINUTE);
      const before = store.writes.length;
      const stopped = await baby.stopActivity("timer", START + 40 * MINUTE);
      expect(stopped).toMatchObject({ startMillis: START, endMillis: START + 10 * MINUTE, duration: 10 * MINUTE, inProgress: false, notes: "Keep me", groupUid: "group" });
      expect(stopped.pauseMillis).toBeUndefined();
      expect(store.writes).toHaveLength(before + 1);
      expect(store.writes.at(-1)).toMatchObject({ inProgress: 0, endMillis: START + 10 * MINUTE, duration: 10 * MINUTE });
      expect(Object.hasOwn(store.writes.at(-1)!, "pauseMillis")).toBe(false);
      expect(await baby.activities.get("timer")).toEqual(stopped);
      const totals = await summary();
      expect(totals.activityCount).toBe(1);
      if (type === "breastfeeding" || type === "pump") {
        expect(stopped).toMatchObject({ leftDuration: 10 * MINUTE, rightDuration: 0 });
        expect(totals).toMatchObject({ leftDurationMillis: 10 * MINUTE, rightDurationMillis: 0 });
      } else expect(totals.durationMillis).toBe(10 * MINUTE);
    });

    it(`excludes both pause intervals when ${type} is paused again after resuming`, async () => {
      const { baby } = fixture(type);
      await baby.startActivity({ uid: "timer", type, startMillis: START, side: "left" });
      await baby.pauseActivity("timer", START + 10 * MINUTE);
      await baby.resumeActivity("timer", START + 30 * MINUTE);
      await baby.pauseActivity("timer", START + 40 * MINUTE);
      const stopped = await baby.stopActivity("timer", START + 60 * MINUTE);
      expect(stopped).toMatchObject({ startMillis: START + 20 * MINUTE, endMillis: START + 40 * MINUTE, duration: 20 * MINUTE, inProgress: false });
      if (type === "breastfeeding" || type === "pump") expect(stopped).toMatchObject({ leftDuration: 20 * MINUTE, rightDuration: 0 });
    });

    it(`keeps the requested stop time after a ${type} timer resumes`, async () => {
      const { baby } = fixture(type);
      await baby.startActivity({ uid: "timer", type, startMillis: START, side: "left" });
      await baby.pauseActivity("timer", START + 10 * MINUTE);
      await baby.resumeActivity("timer", START + 30 * MINUTE);
      expect(await baby.stopActivity("timer", START + 40 * MINUTE)).toMatchObject({ startMillis: START + 20 * MINUTE, endMillis: START + 40 * MINUTE, duration: 20 * MINUTE });
    });
  }

  it("does not report the paused tail as daytime sleep or reduce awake time", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START + 10 * MINUTE);
    await baby.stopActivity("timer", START + 40 * MINUTE);
    const statistics = await baby.getActivityStatistics({ fromMillis: FROM, toMillis: TO });
    expect(statistics.sleep).toMatchObject({ count: 1, durationMillis: 10 * MINUTE, daytimeDurationMillis: 10 * MINUTE, nightDurationMillis: 0 });
    expect(statistics.days[0]).toMatchObject({ daytimeSleepMillis: 10 * MINUTE, awakeMillis: 12 * 60 * MINUTE - 10 * MINUTE });
  });

  it("does not include the finished timer in the paused-tail timeline or overlap checks", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START + 10 * MINUTE);
    await baby.stopActivity("timer", START + 40 * MINUTE);
    expect(await baby.listActivitiesForRange({ fromMillis: START + 15 * MINUTE, toMillis: START + 20 * MINUTE })).toEqual([]);
    expect(await baby.findOverlappingActivities({ uid: "later", type: "sleeping", startMillis: START + 15 * MINUTE, endMillis: START + 20 * MINUTE, inProgress: false })).toEqual([]);
  });

  it("honors an explicitly earlier stop within the active interval", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START + 10 * MINUTE);
    expect(await baby.stopActivity("timer", START + 5 * MINUTE)).toMatchObject({ endMillis: START + 5 * MINUTE, duration: 5 * MINUTE });
  });

  it("retains zero active duration when paused immediately", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START);
    expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ endMillis: START, duration: 0 });
  });

  it.each([0, START + 10 * MINUTE])("does not treat a running timer's pause marker %s as a paused state", async (pauseMillis) => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START, inProgress: true, pauseMillis });
    expect(await baby.stopActivity("timer", START + 40 * MINUTE)).toMatchObject({ endMillis: START + 40 * MINUTE, duration: 40 * MINUTE });
  });

  it("rejects a missing timer without writing", async () => {
    const { baby, store } = fixture();
    await expect(baby.stopActivity("missing", START)).rejects.toThrow("does not exist");
    expect(store.writes).toHaveLength(0);
  });

  it("retains the original pause boundary after a failed write and a later retry", async () => {
    const { baby, store } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START + 10 * MINUTE);
    const original = structuredClone(store.records.get(`${timerCollection}/timer`));
    store.failure = "before";
    await expect(baby.stopActivity("timer", START + 40 * MINUTE)).rejects.toThrow("Request failed");
    expect(store.records.get(`${timerCollection}/timer`)).toEqual(original);
    expect(await baby.stopActivity("timer", START + 50 * MINUTE)).toMatchObject({ endMillis: START + 10 * MINUTE, duration: 10 * MINUTE });
  });

  it.each(["after", "readback"] as const)("persists correct completion data when the %s response fails", async (failure) => {
    const { baby, store } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
    await baby.pauseActivity("timer", START + 10 * MINUTE);
    store.failure = failure;
    await expect(baby.stopActivity("timer", START + 40 * MINUTE)).rejects.toThrow("Request failed");
    expect(await baby.activities.get("timer")).toMatchObject({ endMillis: START + 10 * MINUTE, duration: 10 * MINUTE, inProgress: false });
  });

  it("records the pause as the end while updatedMillis records the default stop call time", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(START + 40 * MINUTE);
    try {
      const { baby } = fixture();
      await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START });
      await baby.pauseActivity("timer", START + 10 * MINUTE);
      expect(await baby.stopActivity("timer")).toMatchObject({ endMillis: START + 10 * MINUTE, duration: 10 * MINUTE, updatedMillis: START + 40 * MINUTE });
    } finally { now.mockRestore(); }
  });
});
