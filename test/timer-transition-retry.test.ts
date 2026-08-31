import { afterEach, describe, expect, it, vi } from "vitest";
import { BabyDaybookClient } from "../src/index.js";
import { createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";
import { sideTimerStore } from "./side-timer-helpers.js";

const MINUTE = 60_000;
const START = new Date(2026, 7, 31, 12).getTime();

function fixture(type = "sleeping") {
  const clock = vi.spyOn(Date, "now").mockReturnValue(START);
  const store = sideTimerStore(type);
  const client = new BabyDaybookClient({
    session: { idToken: "fixture", userId: "user", expiresAt: START + 24 * 60 * MINUTE }, fetch: store.fetch,
  });
  const baby = client.baby("baby");
  const connect = vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" }));
  const sdk = createBabyDaybookToolcraftSDK({
    env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services: { babyDaybook: { connect } },
  });
  const at = (minutes: number) => { clock.mockReturnValue(START + minutes * MINUTE); };
  const start = () => baby.startActivity({ uid: "timer", type, side: "left", startMillis: START, notes: "Keep me" });
  return { baby, store, sdk, connect, at, start };
}

afterEach(() => vi.restoreAllMocks());

describe("Pause and Stop transition retries", () => {
  for (const type of ["sleeping", "breastfeeding", "pump"]) {
    it(`preserves the first ${type} pause and active duration after resume`, async () => {
      const { baby, store, at, start } = fixture(type);
      await start();
      at(10);
      const paused = await baby.pauseActivity("timer");
      const before = store.writes.length;
      at(20);
      expect(await baby.pauseActivity("timer")).toEqual(paused);
      expect(store.writes).toHaveLength(before);
      expect(await baby.activities.get("timer")).toEqual(paused);
      at(30);
      await baby.resumeActivity("timer");
      at(40);
      expect(await baby.stopActivity("timer")).toMatchObject({ startMillis: START + 20 * MINUTE, endMillis: START + 40 * MINUTE, duration: 20 * MINUTE });
    });

    for (const pausedFirst of [false, true]) {
      it(`preserves completed ${type} history after ${pausedFirst ? "paused" : "running"} Stop repeats`, async () => {
        const { baby, store, at, start } = fixture(type);
        await start();
        if (pausedFirst) { at(10); await baby.pauseActivity("timer"); }
        at(20);
        const stopped = await baby.stopActivity("timer");
        expect(stopped).toMatchObject({ inProgress: false, endMillis: START + (pausedFirst ? 10 : 20) * MINUTE });
        const before = store.writes.length;
        at(30);
        expect(await baby.stopActivity("timer")).toEqual(stopped);
        expect(await baby.stopActivity("timer", START + 40 * MINUTE)).toEqual(stopped);
        expect(await baby.activities.get("timer")).toEqual(stopped);
        expect(store.writes).toHaveLength(before);
      });
    }

    it(`rejects pausing completed ${type} history without writing`, async () => {
      const { baby, store, at, start } = fixture(type);
      await start();
      at(20);
      const stopped = await baby.stopActivity("timer");
      const before = store.writes.length;
      at(30);
      await expect(baby.pauseActivity("timer")).rejects.toThrow("not running");
      await expect(baby.pauseActivity("timer", START + 40 * MINUTE)).rejects.toThrow("not running");
      expect(await baby.activities.get("timer")).toEqual(stopped);
      expect(store.writes).toHaveLength(before);
    });

    for (const operation of ["pause", "stop"] as const) {
      for (const failure of ["after", "readback"] as const) {
        it(`${type} ${operation} retry after ${failure} failure preserves the persisted transition`, async () => {
          const { baby, store, at, start } = fixture(type);
          await start();
          const apply = () => operation === "pause" ? baby.pauseActivity("timer") : baby.stopActivity("timer");
          at(operation === "pause" ? 10 : 20);
          store.failure = failure;
          await expect(apply()).rejects.toThrow("Request failed");
          const persisted = await baby.activities.get("timer");
          expect(persisted?.inProgress).toBe(false);
          const before = store.writes.length;
          at(30);
          expect(await apply()).toEqual(persisted);
          expect(store.writes).toHaveLength(before);
          if (operation === "pause") {
            at(40);
            await baby.resumeActivity("timer");
            at(50);
            expect(await baby.stopActivity("timer")).toMatchObject({ duration: 20 * MINUTE });
          }
        });
      }
    }
  }

  it("does not move an existing pause boundary even with an explicitly earlier timestamp", async () => {
    const { baby, store, at, start } = fixture();
    await start();
    at(10);
    const paused = await baby.pauseActivity("timer");
    const before = store.writes.length;
    expect(await baby.pauseActivity("timer", START + 5 * MINUTE)).toEqual(paused);
    expect(store.writes).toHaveLength(before);
  });

  it("allows the first pause of a running timer with an old pause marker", async () => {
    const { baby, at } = fixture();
    await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START, inProgress: true, pauseMillis: START + MINUTE });
    at(10);
    expect(await baby.pauseActivity("timer")).toMatchObject({ inProgress: false, pauseMillis: START + 10 * MINUTE });
  });

  it.each([0, undefined])("treats a native completed record with pause marker %s as completed", async (pauseMillis) => {
    const { baby, store, at } = fixture();
    const completed = await baby.startActivity({ uid: "timer", type: "sleeping", startMillis: START, endMillis: START + 20 * MINUTE, duration: 20 * MINUTE, inProgress: false, pauseMillis });
    const before = store.writes.length;
    at(30);
    expect(await baby.stopActivity("timer")).toEqual(completed);
    await expect(baby.pauseActivity("timer")).rejects.toThrow("not running");
    expect(store.writes).toHaveLength(before);
  });

  for (const operation of ["pause", "stop"] as const) {
    it(`still rejects ${operation} for a missing timer`, async () => {
      const { baby, store } = fixture();
      await expect(operation === "pause" ? baby.pauseActivity("missing") : baby.stopActivity("missing")).rejects.toThrow("does not exist");
      expect(store.writes).toHaveLength(0);
    });

    it(`allows ${operation} after a write rejected before persistence, then suppresses the repeat`, async () => {
      const { baby, store, at, start } = fixture();
      await start();
      const original = structuredClone(store.records);
      const apply = () => operation === "pause" ? baby.pauseActivity("timer") : baby.stopActivity("timer");
      at(10);
      store.failure = "before";
      await expect(apply()).rejects.toThrow("Request failed");
      expect(store.records).toEqual(original);
      at(20);
      const transitioned = await apply();
      expect(operation === "pause" ? transitioned.pauseMillis : transitioned.endMillis).toBe(START + 20 * MINUTE);
      const before = store.writes.length;
      at(30);
      expect(await apply()).toEqual(transitioned);
      expect(store.writes).toHaveLength(before);
    });
  }

  it("keeps intentional timestamp correction available through saveActivity", async () => {
    const { baby, store, at, start } = fixture();
    await start();
    at(20);
    const stopped = await baby.stopActivity("timer");
    at(25);
    const corrected = await baby.saveActivity({ ...stopped, endMillis: START + 15 * MINUTE, duration: 15 * MINUTE, notes: "Corrected" });
    expect(corrected).toMatchObject({ endMillis: START + 15 * MINUTE, duration: 15 * MINUTE, notes: "Corrected", updatedMillis: START + 25 * MINUTE });
    const before = store.writes.length;
    at(30);
    expect(await baby.stopActivity("timer", START + 40 * MINUTE)).toEqual(corrected);
    expect(store.writes).toHaveLength(before);
  });

  it("preserves pause timing through repeated public commands and a later resume", async () => {
    const { sdk, connect, store, at, start } = fixture();
    await start();
    at(10);
    const paused = (await sdk.timeline.timer.pause({ babyUid: "baby", uid: "timer" })).data;
    at(20);
    expect((await sdk.timeline.timer.pause({ babyUid: "baby", uid: "timer" })).data).toEqual(paused);
    at(30);
    await sdk.timeline.timer.resume({ babyUid: "baby", uid: "timer" });
    at(40);
    expect((await sdk.timeline.timer.stop({ babyUid: "baby", uid: "timer" })).data).toMatchObject({ duration: 20 * MINUTE });
    expect(store.writes).toHaveLength(4);
    expect(connect).toHaveBeenCalledTimes(4);
  });

  it("keeps public Stop separate from explicit completed-history correction", async () => {
    const { sdk, connect, store, at, start } = fixture();
    await start();
    at(20);
    const stopped = (await sdk.timeline.timer.stop({ babyUid: "baby", uid: "timer" })).data;
    at(30);
    expect((await sdk.timeline.timer.stop({ babyUid: "baby", uid: "timer" })).data).toEqual(stopped);
    at(35);
    const corrected = (await sdk.advanced.raw.activities.update({ babyUid: "baby", uid: "timer", patchJson: JSON.stringify({ endMillis: START + 15 * MINUTE, duration: 15 * MINUTE, notes: "Corrected" }) })).data;
    expect(corrected).toMatchObject({ endMillis: START + 15 * MINUTE, duration: 15 * MINUTE, notes: "Corrected" });
    at(40);
    expect((await sdk.timeline.timer.stop({ babyUid: "baby", uid: "timer", atMillis: START + 45 * MINUTE })).data).toEqual(corrected);
    expect(store.writes).toHaveLength(3);
    expect(connect).toHaveBeenCalledTimes(4);
  });
});
