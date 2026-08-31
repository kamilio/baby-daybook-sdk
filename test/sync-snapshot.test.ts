import { setImmediate } from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import { createMCPServer } from "toolcraft/mcp";
import { BabyDaybookClient, encodeFields } from "../src/index.js";
import type { ChangeEvent, FetchLike } from "../src/index.js";
import { babyDaybookCommands, createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";

const PROFILE = "babyData/babyUid_baby";
const COLLECTIONS = [
  ...["daTypes", "dailyActions", "groups", "growth", "moments", "dailyNotes", "teething", "acceptedInvites", "pendingInvites", "dailyActionsFiles", "growthFiles", "momentsFiles", "teethingFiles"].map((name) => `${PROFILE}/${name}`),
  "userData/user/babiesReminders/babyUid_baby/reminders",
  "userData/user/babiesSettings/babyUid_baby/settings",
];

function fixture() {
  const documents = new Map<string, Record<string, unknown>>();
  const requests: Array<{ path: string; pageToken: string | null }> = [];
  const failures = new Map<string, number | Error>();
  const pauses = new Map<string, Promise<void>>();
  const paginated = new Set<string>();
  const wire = (path: string, data: Record<string, unknown>) => ({ name: `projects/fixture/databases/(default)/documents/${path}`, fields: encodeFields(data) });
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    expect(init.method ?? "GET").toBe("GET");
    const path = decodeURIComponent(url.pathname.split("/documents/")[1]!);
    const pageToken = url.searchParams.get("pageToken");
    requests.push({ path, pageToken });
    if (pauses.has(path)) await pauses.get(path);
    const failure = failures.get(path);
    if (failure instanceof Error) throw failure;
    if (failure !== undefined) return Response.json({ error: { message: "Fixture upstream unavailable", status: "UNAVAILABLE" } }, { status: failure });
    if (COLLECTIONS.includes(path) || /^userData\/[^/]+\/purchases$/.test(path)) {
      const records = [...documents].filter(([stored]) => stored.startsWith(`${path}/`) && !stored.slice(path.length + 1).includes("/"));
      const offset = Number(pageToken ?? 0);
      const page = paginated.has(path) ? records.slice(offset, offset + 1) : records;
      return Response.json({ documents: page.map(([stored, data]) => wire(stored, data)), ...(paginated.has(path) && offset + 1 < records.length ? { nextPageToken: String(offset + 1) } : {}) });
    }
    expect(path === PROFILE || /^userData\/[^/]+$/.test(path)).toBe(true);
    const record = documents.get(path);
    return record ? Response.json(wire(path, record)) : Response.json({ error: { message: "Missing fixture profile", status: "NOT_FOUND" } }, { status: 404 });
  };
  const client = new BabyDaybookClient({ session: { idToken: "fixture", userId: "user", expiresAt: Date.parse("2030-01-01T00:00:00Z") }, fetch });
  const baby = client.baby("baby");
  const services = { babyDaybook: { connect: vi.fn(async () => ({ client, authFile: "/unused-fixture-auth" })) } };
  const sdk = createBabyDaybookToolcraftSDK({ env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, services });
  const addProfile = (extra: Record<string, unknown> = {}) => documents.set(PROFILE, { uid: "baby", userUid: "owner", name: "Synthetic baby", deleted: 0, ...extra });
  return { baby, sdk, services, documents, requests, failures, pauses, paginated, addProfile };
}

async function completes<T>(operation: Promise<T>): Promise<T> {
  let settled = false;
  const observed = operation.then((value) => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled, "one-shot operation must settle without advancing a polling timer").toBe(true);
  const result = await observed;
  if ("error" in result) throw result.error;
  return result.value;
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

describe("one-pass synchronization snapshots", () => {
  it("returns an empty typed result for the exact missing-profile and empty-collections scenario", async () => {
    const current = fixture();
    const result = await completes(current.sdk.advanced.sync.snapshot({ babyUid: "baby" }));
    expect(result).toEqual({ data: [] });
    expect(current.requests.map(({ path }) => path).sort()).toEqual([PROFILE, ...COLLECTIONS].sort());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(current.requests).toHaveLength(16);
    expect(current.documents.size).toBe(0);
  });

  it("provides a direct one-pass API independent of watch", async () => {
    const current = fixture();
    const watch = vi.spyOn(current.baby, "watch").mockImplementation(() => { throw new Error("Snapshot must not watch"); });
    expect(await completes(current.baby.getSyncSnapshot())).toEqual([]);
    expect(watch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an existing baby immediately even with no activity history or caregiver profile", async () => {
    const current = fixture();
    current.addProfile();
    const result = await completes(current.sdk.advanced.sync.snapshot({ babyUid: "baby" }));
    expect(result.data).toEqual([expect.objectContaining({ collection: "baby", id: "baby", type: "added", value: expect.objectContaining({ name: "Synthetic baby" }) })]);
    expect(current.requests.filter(({ path }) => path === PROFILE)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(COLLECTIONS)("retains available records from %s even without a profile", async (collection) => {
    const current = fixture();
    current.documents.set(`${collection}/record`, { uid: "record", userUid: "shared", babyUid: "baby", userEmailMD5: "email-hash", fileName: "photo.jpg", type: "bottle", startMillis: 1, deleted: 1 });
    const before = structuredClone([...current.documents]);
    const result = await completes(current.sdk.advanced.sync.snapshot({ babyUid: "baby" }));
    const name = collection.split("/").at(-1)!;
    const id = name === "acceptedInvites" ? "shared" : name === "pendingInvites" ? "email-hash" : "record";
    expect(result.data).toEqual([expect.objectContaining({ collection: name, id, type: "added", value: expect.objectContaining({ deleted: expect.anything() }) })]);
    expect([...current.documents]).toEqual(before);
    expect(current.requests).toHaveLength(16);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("matches the initial watcher batch across all collections and caregiver identities", async () => {
    const current = fixture();
    current.addProfile();
    for (const collection of COLLECTIONS) current.documents.set(`${collection}/record`, {
      uid: "record", userUid: "shared", babyUid: "baby", userEmailMD5: "email-hash", productId: "premium", fileName: "photo.jpg", type: "bottle", startMillis: 1, deleted: 0,
    });
    for (const user of ["owner", "shared"]) {
      current.documents.set(`userData/${user}`, { uid: user, displayName: user });
      current.documents.set(`userData/${user}/purchases/premium`, { userUid: user, productId: "premium" });
    }
    const before = structuredClone([...current.documents]);
    const snapshot = await completes(current.baby.getSyncSnapshot());
    expect(snapshot).toHaveLength(20);
    expect(new Set(snapshot.map(({ collection }) => collection)).size).toBe(18);
    expect(snapshot.filter(({ collection }) => collection === "caregiversPurchases").map(({ id }) => id)).toEqual(["owner:premium", "shared:premium"]);
    expect(snapshot.every(({ type }) => type === "added")).toBe(true);
    const iterator = current.baby.watch();
    try { expect((await completes(iterator.next())).value).toEqual(snapshot); }
    finally { await iterator.return(undefined); }
    expect([...current.documents]).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps profile tombstones without fetching an inactive owner's records", async () => {
    const current = fixture();
    current.addProfile({ deleted: 1 });
    expect(await completes(current.baby.getSyncSnapshot())).toEqual([expect.objectContaining({ collection: "baby", type: "added", value: expect.objectContaining({ deleted: 1 }) })]);
    expect(current.requests).toHaveLength(16);
  });

  it("finishes pagination in one pass and retains tombstones on later pages", async () => {
    const current = fixture();
    const collection = `${PROFILE}/dailyActions`;
    current.paginated.add(collection);
    for (const [index, uid] of ["first", "second", "third"].entries()) current.documents.set(`${collection}/${uid}`, { uid, userUid: "owner", babyUid: "baby", type: "bottle", startMillis: index, deleted: index === 2 ? 1 : 0 });
    const result = await completes(current.sdk.advanced.sync.snapshot({ babyUid: "baby" }));
    expect((result.data as unknown as ChangeEvent[]).map(({ id }) => id)).toEqual(["first", "second", "third"]);
    expect(current.requests.filter(({ path }) => path === collection).map(({ pageToken }) => pageToken)).toEqual([null, "1", "2"]);
    expect(current.requests.filter(({ path }) => path === PROFILE)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the current collection read but never polls for future data", async () => {
    const current = fixture();
    let release!: () => void;
    const collection = `${PROFILE}/dailyActions`;
    current.pauses.set(collection, new Promise<void>((resolve) => { release = resolve; }));
    let settled = false;
    const operation = current.sdk.advanced.sync.snapshot({ babyUid: "baby" });
    void operation.then(() => { settled = true; }, () => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    release();
    expect(await completes(operation)).toEqual({ data: [] });
    expect(current.requests).toHaveLength(16);
  });

  it("takes independent fresh snapshots on repeated calls without retaining change state", async () => {
    const current = fixture();
    expect(await completes(current.baby.getSyncSnapshot())).toEqual([]);
    current.addProfile();
    const first = await completes(current.baby.getSyncSnapshot());
    first[0]!.id = "modified-by-caller";
    current.addProfile({ name: "Renamed" });
    const next = await completes(current.baby.getSyncSnapshot());
    expect(next).toEqual([expect.objectContaining({ id: "baby", type: "added", value: expect.objectContaining({ name: "Renamed" }) })]);
    current.documents.clear();
    expect(await completes(current.baby.getSyncSnapshot())).toEqual([]);
    expect(current.requests.filter(({ path }) => path === PROFILE)).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([PROFILE, `${PROFILE}/dailyActions`, "userData/owner", "userData/owner/purchases"])("propagates a failed %s read without retry timers or an empty success", async (path) => {
    const current = fixture();
    current.addProfile();
    current.failures.set(path, 503);
    await expect(completes(current.sdk.advanced.sync.snapshot({ babyUid: "baby" }))).rejects.toThrow("Fixture upstream unavailable");
    expect(current.requests.filter((request) => request.path === path)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a transport failure without polling", async () => {
    const current = fixture();
    current.failures.set(PROFILE, new Error("Fixture connection ended"));
    await expect(completes(current.baby.getSyncSnapshot())).rejects.toThrow("Request failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("snapshot command adapters", () => {
  it.each([false, true])("completes the CLI command with profile present=%s", async (present) => {
    const current = fixture();
    if (present) current.addProfile();
    const output: string[] = [];
    await completes(runCLI(babyDaybookCommands, { argv: ["node", "baby-daybook", "advanced", "sync", "snapshot", "baby", "--output", "json"], services: current.services, env: { BABY_DAYBOOK_AUTH_FILE: "/unused-fixture-auth" }, controls: { output: true }, outputEmitter: (entry) => { output.push(entry); }, errorReports: false }));
    const result = JSON.parse(output.join("\n"));
    expect(result.data).toHaveLength(present ? 1 : 0);
    expect(current.requests.filter(({ path }) => path === PROFILE)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("completes an MCP tools/call with profile present=%s", async (present) => {
    const current = fixture();
    if (present) current.addProfile();
    const server = createMCPServer(babyDaybookCommands, { name: "snapshot-fixture", version: "0.1.0", omitRootToolNamePrefix: true, services: current.services });
    const session = server.createMessageSession(() => undefined);
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1.0.0" } });
      const response = await completes(session.handleMessage("tools/call", { name: "advanced__sync__snapshot", arguments: { baby_uid: "baby" } })) as { result: { structuredContent: { data: unknown[] }; content: Array<{ type: string; text: string }>; isError?: boolean } };
      expect(response.result.isError).not.toBe(true);
      expect(response.result.structuredContent.data).toHaveLength(present ? 1 : 0);
      expect(response.result.content).toEqual([{ type: "text", text: JSON.stringify(response.result.structuredContent) }]);
      expect(current.requests.filter(({ path }) => path === PROFILE)).toHaveLength(1);
    } finally { session.close(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves empty polling watches waiting until explicitly aborted", async () => {
    const current = fixture();
    const controller = new AbortController();
    const iterator = current.baby.watch({ intervalMillis: 60_000, signal: controller.signal });
    const pending = iterator.next();
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await completes(pending)).toEqual({ value: undefined, done: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
