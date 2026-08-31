import { setImmediate } from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BabyDaybookClient, encodeFields } from "../src/index.js";
import type { ChangeEvent, FetchLike } from "../src/index.js";

const PROFILE = "babyData/babyUid_baby";
const ACTIVITIES = `${PROFILE}/dailyActions`;
const CAREGIVER = "userData/owner";
const PURCHASES = `${CAREGIVER}/purchases`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function fixture() {
  const controller = new AbortController();
  const documents = new Map<string, Record<string, unknown>>([
    [PROFILE, { uid: "baby", userUid: "owner", name: "Synthetic baby", deleted: 0 }],
  ]);
  const requests: Array<{ path: string; afterAbort: boolean }> = [];
  const pauses = new Map<string, ReturnType<typeof deferred>>();
  const entered = new Map<string, ReturnType<typeof deferred>>();
  const failures = new Map<string, Error>();
  const wire = (path: string, data: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(data) });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    expect(init.method ?? "GET").toBe("GET");
    const path = decodeURIComponent(url.pathname.split("/documents/")[1]!);
    requests.push({ path, afterAbort: controller.signal.aborted });
    entered.get(path)?.resolve();
    await pauses.get(path)?.promise;
    if (failures.has(path)) throw failures.get(path);
    if (path === PROFILE || path === CAREGIVER) {
      const data = documents.get(path);
      return data ? Response.json(wire(path, data)) : Response.json({ error: { message: "Fixture not found", status: "NOT_FOUND" } }, { status: 404 });
    }
    const records = [...documents].filter(([stored]) => stored.startsWith(`${path}/`) && !stored.slice(path.length + 1).includes("/"));
    return Response.json({ documents: records.map(([stored, data]) => wire(stored, data)) });
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("baby");
  const pause = (path: string) => {
    const gate = deferred();
    const started = deferred();
    pauses.set(path, gate);
    entered.set(path, started);
    return { release: gate.resolve, entered: started.promise };
  };
  return { baby, controller, documents, requests, failures, pause };
}

async function settled<T>(operation: Promise<T>): Promise<T> {
  let complete = false;
  const result = operation.then((value) => ({ value }), (error: unknown) => ({ error })).finally(() => { complete = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(complete, "watch should finish without another polling timer").toBe(true);
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("polling cancellation", () => {
  it.each([PROFILE, ACTIVITIES, CAREGIVER, PURCHASES].flatMap((path) => [false, true].map((initial) => ({ path, initial }))))(
    "discards a pending snapshot at $path, initial=$initial",
    async ({ path, initial }) => {
      const current = fixture();
      const iterator = current.baby.watch({ intervalMillis: 5, signal: current.controller.signal });
      if (!initial) expect((await iterator.next()).value).toEqual([expect.objectContaining({ type: "added", collection: "baby" })]);
      const gate = current.pause(path);
      current.documents.get(PROFILE)!.name = "Changed synthetic baby";
      const pending = iterator.next();
      try {
        if (!initial) await vi.advanceTimersByTimeAsync(5);
        await gate.entered;
        current.controller.abort();
        gate.release();
        expect(await settled(pending)).toEqual({ value: undefined, done: true });
        expect(current.requests.filter((request) => request.afterAbort)).toEqual([]);
        if (path === PROFILE || path === ACTIVITIES) expect(current.requests.filter((request) => request.path === CAREGIVER)).toHaveLength(initial ? 0 : 1);
        const count = current.requests.length;
        expect(await iterator.next()).toEqual({ value: undefined, done: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(current.requests).toHaveLength(count);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        current.controller.abort();
        gate.release();
        await pending.catch(() => undefined);
        await iterator.return(undefined);
      }
    },
  );

  it.each(["added", "modified", "deleted", "removed", "unchanged"])("does not deliver a canceled %s activity batch", async (change) => {
    const current = fixture();
    const path = `${ACTIVITIES}/activity`;
    const record = { uid: "activity", babyUid: "baby", userUid: "owner", type: "bottle", startMillis: 1, deleted: 0 };
    if (change !== "added") current.documents.set(path, record);
    const iterator = current.baby.watch({ intervalMillis: 5, signal: current.controller.signal });
    await iterator.next();
    if (change === "added") current.documents.set(path, record);
    if (change === "modified") record.startMillis = 2;
    if (change === "deleted") record.deleted = 1;
    if (change === "removed") current.documents.delete(path);
    const gate = current.pause(ACTIVITIES);
    const pending = iterator.next();
    try {
      await vi.advanceTimersByTimeAsync(5);
      await gate.entered;
      current.controller.abort();
      gate.release();
      expect(await settled(pending)).toEqual({ value: undefined, done: true });
      expect(current.requests.some((request) => request.afterAbort)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      current.controller.abort();
      gate.release();
      await pending.catch(() => undefined);
      await iterator.return(undefined);
    }
  });

  it("does not read for an already-aborted signal", async () => {
    const current = fixture();
    current.controller.abort("view closed");
    expect(await current.baby.watch({ signal: current.controller.signal }).next()).toEqual({ value: undefined, done: true });
    expect(current.requests).toEqual([]);
  });

  it("does not start another read after cancellation while suspended at a yield", async () => {
    const current = fixture();
    const iterator = current.baby.watch({ signal: current.controller.signal });
    expect((await iterator.next()).done).toBe(false);
    const count = current.requests.length;
    current.controller.abort();
    expect(await settled(iterator.next())).toEqual({ value: undefined, done: true });
    expect(current.requests).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("wakes promptly from an interval wait, empty=%s", async (empty) => {
    const current = fixture();
    if (empty) current.documents.clear();
    const iterator = current.baby.watch({ signal: current.controller.signal });
    if (!empty) await iterator.next();
    const pending = iterator.next();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBe(1);
    const count = current.requests.length;
    current.controller.abort();
    expect(await settled(pending)).toEqual({ value: undefined, done: true });
    expect(current.requests).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps added, modified, tombstone, and removed events when not canceled", async () => {
    const current = fixture();
    const iterator = current.baby.watch({ intervalMillis: 5 });
    expect((await iterator.next()).value).toEqual([expect.objectContaining({ type: "added" })]);
    const nextBatch = async (): Promise<IteratorResult<ChangeEvent[]>> => {
      const pending = iterator.next();
      await vi.advanceTimersByTimeAsync(5);
      return settled(pending);
    };
    current.documents.get(PROFILE)!.name = "Changed";
    expect((await nextBatch()).value).toEqual([expect.objectContaining({ type: "modified", value: expect.objectContaining({ name: "Changed" }) })]);
    current.documents.get(PROFILE)!.deleted = 1;
    expect((await nextBatch()).value).toEqual([expect.objectContaining({ type: "deleted" })]);
    current.documents.clear();
    expect((await nextBatch()).value).toEqual([expect.objectContaining({ type: "deleted" })]);
    await iterator.return(undefined);
  });

  it.each([false, true])("preserves upstream errors, canceled=%s", async (canceled) => {
    const current = fixture();
    const gate = current.pause(PROFILE);
    const failure = new Error("Fixture transport failed");
    current.failures.set(PROFILE, failure);
    const iterator = current.baby.watch({ signal: current.controller.signal });
    const pending = iterator.next();
    const observed = pending.catch((error: unknown) => error);
    await gate.entered;
    if (canceled) current.controller.abort();
    gate.release();
    expect(await settled(observed)).toMatchObject({ name: "BabyDaybookApiError", cause: failure });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not cancel another watcher or the one-pass snapshot", async () => {
    const current = fixture();
    const stopped = current.baby.watch({ signal: current.controller.signal });
    const other = current.baby.watch();
    current.controller.abort();
    expect(await stopped.next()).toEqual({ value: undefined, done: true });
    const initial = await other.next();
    expect(initial.done).toBe(false);
    expect(await current.baby.getSyncSnapshot()).toEqual(initial.value);
    await other.return(undefined);
  });
});
