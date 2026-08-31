import { describe, expect, it } from "vitest";
import { AuthSession, FirestoreClient } from "../src/index.js";
import { applyGarminEvents } from "../src/garmin-relay.js";
import { diaperCollection, diaperStore } from "./garmin-diaper-helpers.js";

const wet = { id: "wet", type: "diaper_change" as const, startMillis: 60_000, pee: true, poo: false };
const dirty = { id: "dirty", type: "diaper_change" as const, startMillis: 61_000, pee: false, poo: true };

function fixture() {
  const state = diaperStore();
  const firestore = new FirestoreClient(new AuthSession({ idToken: "fixture", userId: "user", expiresAt: Date.now() + 3600_000 }, { fetch: state.fetch }));
  const apply = (events: ReadonlyArray<typeof wet>, updatedMillis = 100_000) => applyGarminEvents(firestore, "baby", "user", events, updatedMillis, []);
  return { state, apply };
}

describe("Garmin merged diaper retries", () => {
  for (const events of [[wet, dirty], [dirty, wet]] as const) {
    for (const wholeBatch of [false, true]) {
      it(`retains one combined record after ${events[0].id}-first ${wholeBatch ? "whole-batch" : "merged-event"} retries`, async () => {
        const { state, apply } = fixture();
        await apply(events);
        expect(state.records.size).toBe(1);
        const merged = structuredClone([...state.records.values()][0]);
        expect(merged).toMatchObject({ pee: 1, poo: 1 });
        for (let attempt = 0; attempt < 3; attempt += 1) await apply(wholeBatch ? events : [events[1]], 200_000 + attempt);
        expect(state.records.size).toBe(1);
        expect([...state.records.values()][0]).toEqual(merged);
        expect(state.commits).toBe(2);
      });
    }
  }

  it.each(["before", "after", "readback"] as const)("retries a failed %s merge without duplicate history", async (failure) => {
    const { state, apply } = fixture();
    await apply([wet]);
    state.failure = failure;
    await expect(apply([dirty])).rejects.toThrow("Request failed");
    await apply([wet, dirty]);
    expect(state.records.size).toBe(1);
    expect([...state.records.values()][0]).toMatchObject({ pee: 1, poo: 1 });
    expect(state.commits).toBe(2);
  });

  it("does not merge a consumed event into a newer complementary diaper", async () => {
    const { state, apply } = fixture();
    await apply([wet, dirty]);
    await apply([{ ...wet, id: "next-wet", startMillis: dirty.startMillis }]);
    const saved = structuredClone(state.records);
    await apply([dirty]);
    expect(state.records).toEqual(saved);
    expect(state.commits).toBe(3);
  });

  it("keeps a later phone correction when the whole merged batch retries", async () => {
    const { state, apply } = fixture();
    await apply([wet, dirty]);
    const recordPath = `${diaperCollection}/wet`;
    const corrected = { ...state.records.get(recordPath), notes: "Phone correction", poo: 0, startMillis: 900_000 };
    state.records.set(recordPath, corrected);
    await apply([wet, dirty]);
    expect([...state.records.values()]).toEqual([corrected]);
    expect(state.commits).toBe(2);
  });

  it.each([true, 1])("retains consumed IDs on soft-deleted records (%s)", async (deleted) => {
    const { state, apply } = fixture();
    await apply([wet, dirty]);
    const recordPath = `${diaperCollection}/wet`;
    const removed = { ...state.records.get(recordPath), deleted };
    state.records.set(recordPath, removed);
    await apply([wet, dirty]);
    expect([...state.records.values()]).toEqual([removed]);
    expect(state.commits).toBe(2);
  });

  it("finds a consumed ID on a later page", async () => {
    const { state, apply } = fixture();
    state.records.set(`${diaperCollection}/older`, { uid: "older", type: "diaper_change", startMillis: 0, pee: 0, poo: 0 });
    state.pageSize = 1;
    await apply([wet, dirty]);
    const saved = structuredClone(state.records);
    await apply([dirty]);
    expect(state.records).toEqual(saved);
    expect(state.commits).toBe(2);
  });

  it("keeps distinct dirty events separate after the first merge", async () => {
    const { state, apply } = fixture();
    await apply([wet, dirty, { ...dirty, id: "second-dirty" }]);
    await apply([dirty, { ...dirty, id: "second-dirty" }]);
    expect(state.records.size).toBe(2);
    expect(state.commits).toBe(3);
  });

  it.each([{ pee: true, poo: true }, { pee: false, poo: false }])("preserves standalone diaper retries (%j)", async (fields) => {
    const { state, apply } = fixture();
    const event = { ...wet, ...fields };
    await apply([event]);
    const saved = structuredClone(state.records);
    await apply([event], 200_000);
    expect(state.records).toEqual(saved);
    expect(state.commits).toBe(1);
  });
});
