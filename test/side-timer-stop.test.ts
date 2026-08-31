import { describe, expect, it, vi } from "vitest";
import { BabyDaybookClient } from "../src/index.js";
import { sideTimerStore, timerCollection } from "./side-timer-helpers.js";

const MINUTE = 60_000;
const START = Date.UTC(2026, 7, 31, 12);

function fixture(type = "breastfeeding") {
  const store = sideTimerStore(type);
  const client = new BabyDaybookClient({
    session: { idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 },
    fetch: store.fetch,
  });
  const baby = client.baby("baby");
  const summary = async () => (await baby.getDayActivityTypeSummaries({
    fromMillis: START - 12 * 60 * MINUTE, toMillis: START + 12 * 60 * MINUTE - 1,
    nowMillis: START + 60 * MINUTE,
  })).find(item => item.activityType.uid === type)!;
  return { baby, store, summary };
}

describe("side timer completion", () => {
  for (const type of ["breastfeeding", "pump"]) {
    for (const side of ["left", "right"] as const) {
      it(`persists an unswitched ${type} ${side} segment and its daily total in one stop write`, async () => {
        const { baby, store, summary } = fixture(type);
        await baby.startActivity({ uid: "timer", type, side, startMillis: START, notes: "Keep me", groupUid: "group" });
        const priorWrites = store.writes.length;
        const stopped = await baby.stopActivity("timer", START + 25 * MINUTE);
        const left = side === "left" ? 25 * MINUTE : 0;
        const right = side === "right" ? 25 * MINUTE : 0;
        expect(stopped).toMatchObject({ inProgress: false, duration: 25 * MINUTE, leftDuration: left, rightDuration: right, notes: "Keep me", groupUid: "group" });
        expect(store.writes).toHaveLength(priorWrites + 1);
        expect(store.writes.at(-1)).toMatchObject({ inProgress: 0, leftDuration: left, rightDuration: right });
        expect(await baby.activities.get("timer")).toEqual(stopped);
        const totals = await summary();
        expect(totals).toMatchObject({ activityCount: 1, leftDurationMillis: left, rightDurationMillis: right });
        expect(totals.leftDurationMillis + totals.rightDurationMillis).toBe(stopped.duration);
      });
    }

    it(`keeps the final ${type} segment after a side switch`, async () => {
      const { baby, summary } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "left", startMillis: START });
      await baby.switchBreastfeedingSide("timer", "right", START + 10 * MINUTE);
      const stopped = await baby.stopActivity("timer", START + 25 * MINUTE);
      expect(stopped).toMatchObject({ duration: 25 * MINUTE, leftDuration: 10 * MINUTE, rightDuration: 15 * MINUTE });
      const totals = await summary();
      expect(totals).toMatchObject({ activityCount: 1, leftDurationMillis: 10 * MINUTE, rightDurationMillis: 15 * MINUTE });
      expect(totals.leftDurationMillis + totals.rightDurationMillis).toBe(stopped.duration);
    });

    it(`retains all ${type} segments after switching back`, async () => {
      const { baby } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "left", startMillis: START });
      await baby.switchBreastfeedingSide("timer", "right", START + 10 * MINUTE);
      await baby.switchBreastfeedingSide("timer", "left", START + 25 * MINUTE);
      expect(await baby.stopActivity("timer", START + 30 * MINUTE)).toMatchObject({ duration: 30 * MINUTE, leftDuration: 15 * MINUTE, rightDuration: 15 * MINUTE });
    });

    it(`records both selected ${type} sides without doubling them on a later stop`, async () => {
      const { baby, summary } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "both", startMillis: START });
      expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ duration: 25 * MINUTE, leftDuration: 25 * MINUTE, rightDuration: 25 * MINUTE });
      expect(await summary()).toMatchObject({ leftDurationMillis: 25 * MINUTE, rightDurationMillis: 25 * MINUTE });
      expect(await baby.stopActivity("timer", START + 35 * MINUTE)).toMatchObject({ leftDuration: 25 * MINUTE, rightDuration: 25 * MINUTE });
    });

    it(`settles a paused ${type} side only through the pause time`, async () => {
      const { baby, summary } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "left", startMillis: START });
      await baby.pauseActivity("timer", START + 10 * MINUTE);
      expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ leftDuration: 10 * MINUTE, rightDuration: 0 });
      expect(await summary()).toMatchObject({ leftDurationMillis: 10 * MINUTE, rightDurationMillis: 0 });
    });

    it(`settles a switched ${type} side after pause and resume`, async () => {
      const { baby, summary } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "left", startMillis: START });
      await baby.switchBreastfeedingSide("timer", "right", START + 10 * MINUTE);
      await baby.pauseActivity("timer", START + 20 * MINUTE);
      await baby.resumeActivity("timer", START + 30 * MINUTE);
      expect(await baby.stopActivity("timer", START + 40 * MINUTE)).toMatchObject({ duration: 30 * MINUTE, leftDuration: 10 * MINUTE, rightDuration: 20 * MINUTE });
      expect(await summary()).toMatchObject({ leftDurationMillis: 10 * MINUTE, rightDurationMillis: 20 * MINUTE });
    });

    it(`does not recount already accumulated ${type} side durations`, async () => {
      const { baby } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "left", startMillis: START, leftDuration: 4 * MINUTE, rightDuration: 6 * MINUTE });
      expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ leftDuration: 19 * MINUTE, rightDuration: 6 * MINUTE });
    });

    it(`does not add side duration to an already completed ${type}`, async () => {
      const { baby } = fixture(type);
      await baby.startActivity({ uid: "timer", type, side: "right", startMillis: START, inProgress: false, endMillis: START + 10 * MINUTE, leftDuration: 4 * MINUTE, rightDuration: 6 * MINUTE });
      expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ leftDuration: 4 * MINUTE, rightDuration: 6 * MINUTE });
    });
  }

  it("does not change side fields on other timer types", async () => {
    const { baby } = fixture("sleeping");
    await baby.startActivity({ uid: "timer", type: "sleeping", side: "left", startMillis: START, leftDuration: 4, rightDuration: 6 });
    expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ duration: 25 * MINUTE, leftDuration: 4, rightDuration: 6 });
  });

  it("does not assign an unknown side", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "breastfeeding", side: "", startMillis: START, leftDuration: 4, rightDuration: 6 });
    expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ leftDuration: 4, rightDuration: 6 });
  });

  it("does not make side durations negative for an earlier stop time", async () => {
    const { baby } = fixture();
    await baby.startActivity({ uid: "timer", type: "breastfeeding", side: "left", startMillis: START });
    expect(await baby.stopActivity("timer", START - MINUTE)).toMatchObject({ leftDuration: 0, rightDuration: 0 });
  });

  it("rejects missing timers without writing", async () => {
    const { baby, store } = fixture();
    await expect(baby.stopActivity("missing", START)).rejects.toThrow("does not exist");
    expect(store.writes).toHaveLength(0);
  });

  for (const failure of ["before", "after", "readback"] as const) {
    it(`retries a ${failure} stop failure without losing or recounting side time`, async () => {
      const { baby, store } = fixture();
      await baby.startActivity({ uid: "timer", type: "breastfeeding", side: "right", startMillis: START });
      const original = structuredClone(store.records.get(`${timerCollection}/timer`));
      store.failure = failure;
      await expect(baby.stopActivity("timer", START + 25 * MINUTE)).rejects.toThrow("Request failed");
      if (failure === "before") expect(store.records.get(`${timerCollection}/timer`)).toEqual(original);
      expect(await baby.stopActivity("timer", START + 25 * MINUTE)).toMatchObject({ leftDuration: 0, rightDuration: 25 * MINUTE });
    });
  }

  it("uses the current time when no stop timestamp is supplied", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(START + 25 * MINUTE);
    try {
      const { baby } = fixture();
      await baby.startActivity({ uid: "timer", type: "breastfeeding", side: "left", startMillis: START });
      expect(await baby.stopActivity("timer")).toMatchObject({ endMillis: START + 25 * MINUTE, updatedMillis: START + 25 * MINUTE, leftDuration: 25 * MINUTE, rightDuration: 0 });
    } finally { now.mockRestore(); }
  });
});
