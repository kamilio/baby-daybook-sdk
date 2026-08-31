import type { IncomingMessage, ServerResponse } from "node:http";
import { BabyDaybookAuth } from "./auth.js";
import { buildPointActivity, encodeDailyAction } from "./daily-actions.js";
import { BabyDaybookApiError, BabyDaybookAuthError } from "./errors.js";
import { FirestoreClient } from "./firestore.js";
import type { FetchLike } from "./types.js";

const MAX_BODY_BYTES = 48 * 1024;
const MAX_EVENTS = 10;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

interface GarminEvent {
  id: string;
  type: "bottle" | "diaper_change" | "sleeping";
  startMillis: number;
  volume?: number;
  pee?: boolean;
  poo?: boolean;
  bottleGroupUid?: string;
  milkType?: "mothers_milk" | "formula";
  activityId?: string;
  endMillis?: number;
  duration?: number;
  inProgress?: boolean;
}

interface GarminBottleGroup { uid: string; title: string; messageKey: string }

interface GarminClient {
  appVersion: string;
  internalVersion: number;
  authPrefix: string;
}

interface GarminSyncRequest {
  refreshToken: string;
  babyUid: string;
  events: GarminEvent[];
  client: GarminClient | null;
}

export async function handleGarminSync(
  request: IncomingMessage,
  response: ServerResponse,
  fetch: FetchLike = globalThis.fetch,
): Promise<void> {
  let stage = "read_request";
  let diagnostic = { appVersion: "unknown", internalVersion: -1, authPrefix: "unknown", eventCount: 0, eventTypes: [] as string[] };
  try {
    const raw = await readJsonBody(request);
    stage = "validate_request";
    const input = validateSyncRequest(raw);
    diagnostic = {
      appVersion: input.client?.appVersion ?? "unknown",
      internalVersion: input.client?.internalVersion ?? -1,
      authPrefix: input.client?.authPrefix ?? "unknown",
      eventCount: input.events.length,
      eventTypes: input.events.map(({ type }) => type),
    };
    console.info("garmin_sync", JSON.stringify({ stage: "received", ...diagnostic }));
    stage = "authenticate";
    const session = await new BabyDaybookAuth({ fetch }).fromRefreshToken(input.refreshToken);
    const firestore = new FirestoreClient(session);
    const updatedMillis = Date.now();
    stage = "load_bottle_groups";
    const bottleGroups = await listBottleGroups(firestore, input.babyUid);
    stage = "apply_events";
    await applyGarminEvents(
      firestore,
      input.babyUid,
      session.userId,
      input.events,
      updatedMillis,
      bottleGroups,
    );
    stage = "load_snapshot";
    const [latest, activeSleep, baby] = await Promise.all([
      latestEventMillis(firestore, input.babyUid),
      latestActiveSleep(firestore, input.babyUid),
      garminBabyProfile(firestore, input.babyUid),
    ]);
    sendJson(response, 200, {
      ok: true,
      acked: input.events.map(({ id }) => id),
      latest,
      bottleGroups,
      activeSleep,
      baby,
      refreshToken: session.snapshot.refreshToken,
      userId: session.userId,
    });
    console.info("garmin_sync", JSON.stringify({ stage: "complete", status: 200, ...diagnostic }));
  } catch (error) {
    const status = relayErrorStatus(error);
    console.warn("garmin_sync", JSON.stringify({
      stage,
      status,
      error: relayErrorCode(status),
      ...diagnostic,
    }));
    sendJson(response, status, { ok: false, error: relayErrorCode(status) });
  }
}

export async function garminBabyProfile(
  firestore: Pick<FirestoreClient, "get">,
  babyUid: string,
): Promise<{ name: string; birthdayMillis: number | null }> {
  const document = await firestore.get<{ name?: unknown; birthdayMillis?: unknown }>(`babyData/babyUid_${babyUid}`);
  const name = typeof document?.data.name === "string" && document.data.name.trim()
    ? document.data.name.trim()
    : "Baby";
  const birthdayMillis = typeof document?.data.birthdayMillis === "number" &&
    Number.isSafeInteger(document.data.birthdayMillis) && document.data.birthdayMillis >= 0
    ? document.data.birthdayMillis
    : null;
  return { name, birthdayMillis };
}

export async function applyGarminEvents(
  firestore: Pick<FirestoreClient, "list" | "set">,
  babyUid: string,
  userUid: string,
  events: readonly GarminEvent[],
  updatedMillis: number,
  bottleGroups: readonly GarminBottleGroup[],
): Promise<void> {
  for (const event of events) {
    const groupUid = event.type === "bottle" ? resolveBottleGroupUid(event, bottleGroups) : "";
    if (event.type === "diaper_change" && await mergeComplementaryGarminDiaper(
      firestore, babyUid, event, updatedMillis,
    )) continue;
    const activityId = event.activityId ?? event.id;
    const data = buildGarminEventDocument(event, userUid, babyUid, updatedMillis, groupUid);
    const path = `babyData/babyUid_${babyUid}/dailyActions/${activityId}`;
    // Stable watch IDs make retries idempotent. Use the same commit/set path
    // as the native SDK instead of Firestore batchWrite, which is rejected by
    // the production Firebase rules even for an otherwise authorized record.
    await firestore.set(path, data, { doubleFields: ["volume"] });
  }
}

async function mergeComplementaryGarminDiaper(
  firestore: Pick<FirestoreClient, "list" | "set">,
  babyUid: string,
  event: GarminEvent,
  updatedMillis: number,
): Promise<boolean> {
  const collectionPath = `babyData/babyUid_${babyUid}/dailyActions`;
  const activities = await firestore.list<Record<string, unknown>>(collectionPath, { includeDeleted: true });
  if (activities.some(({ id, data }) => id === event.id
    || (Array.isArray(data.garminMergedEventIds) && data.garminMergedEventIds.includes(event.id)))) {
    return true;
  }

  const isWetOnly = event.pee === true && event.poo !== true;
  const isDirtyOnly = event.poo === true && event.pee !== true;
  if (!isWetOnly && !isDirtyOnly) return false;

  const complementary = activities
    .filter(({ id, data }) => id !== event.id
      && data.deleted !== true && data.deleted !== 1
      && data.type === "diaper_change"
      && typeof data.startMillis === "number"
      && Math.abs(data.startMillis - event.startMillis) <= 60_000
      && (isWetOnly
        ? (data.poo === true || data.poo === 1) && data.pee !== true && data.pee !== 1
        : (data.pee === true || data.pee === 1) && data.poo !== true && data.poo !== 1))
    .sort((left, right) => Math.abs((left.data.startMillis as number) - event.startMillis)
      - Math.abs((right.data.startMillis as number) - event.startMillis))[0];
  if (!complementary) return false;

  await firestore.set(`${collectionPath}/${complementary.id}`, {
    ...complementary.data,
    pee: 1,
    poo: 1,
    updatedMillis,
    garminMergedEventIds: [
      ...(Array.isArray(complementary.data.garminMergedEventIds) ? complementary.data.garminMergedEventIds : []),
      event.id,
    ],
  }, { doubleFields: ["volume"] });
  return true;
}

export async function createGarminEventsIfAbsent(
  firestore: Pick<FirestoreClient, "createManyIfAbsent">,
  babyUid: string,
  userUid: string,
  events: readonly GarminEvent[],
  updatedMillis: number,
  bottleGroupUid = "",
): Promise<boolean[]> {
  return firestore.createManyIfAbsent(events.map((event) => ({
    path: `babyData/babyUid_${babyUid}/dailyActions/${event.id}`,
    data: buildGarminEventDocument(event, userUid, babyUid, updatedMillis, bottleGroupUid),
    doubleFields: ["volume"],
  })));
}

export function validateSyncRequest(value: unknown): GarminSyncRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GarminRelayInputError();
  const candidate = value as Record<string, unknown>;
  const refreshToken = requiredSafeString(candidate.refreshToken, 4096, false);
  const babyUid = requiredSafeString(candidate.babyUid, 128, true);
  if (!Array.isArray(candidate.events) || candidate.events.length > MAX_EVENTS) {
    throw new GarminRelayInputError();
  }
  const events = candidate.events.map(validateEvent);
  if (new Set(events.map(({ id }) => id)).size !== events.length) throw new GarminRelayInputError();
  const client = validateClient(candidate.client);
  return { refreshToken, babyUid, events, client };
}

function validateClient(value: unknown): GarminClient | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GarminRelayInputError();
  const client = value as Record<string, unknown>;
  const appVersion = requiredSafeString(client.appVersion, 64, false);
  const authPrefix = requiredSafeString(client.authPrefix, 8, false);
  if (!/^[0-9A-Za-z.-]+$/u.test(appVersion) || typeof client.internalVersion !== "number" ||
      !Number.isSafeInteger(client.internalVersion) || client.internalVersion < 0 ||
      !/^[A-Za-z0-9_-]{1,8}$/u.test(authPrefix)) {
    throw new GarminRelayInputError();
  }
  return { appVersion, internalVersion: client.internalVersion, authPrefix };
}

interface LatestActivity {
  uid?: string;
  type?: string;
  startMillis?: number;
  pee?: number | boolean;
  poo?: number | boolean;
  deleted?: boolean | number;
  inProgress?: boolean | number;
}

export async function latestActiveSleep(
  firestore: FirestoreClient,
  babyUid: string,
): Promise<{ activityId: string; startMillis: number } | null> {
  let pageToken: string | undefined;
  do {
    const page = await firestore.listPage<LatestActivity>(`babyData/babyUid_${babyUid}/dailyActions`, {
      pageSize: 300,
      pageToken,
      orderBy: "startMillis desc",
    });
    for (const { id, data } of page.documents) {
      const uid = data.uid ?? id;
      const active = data.inProgress === true || data.inProgress === 1;
      const deleted = data.deleted === true || data.deleted === 1;
      if (data.type === "sleeping" && active && !deleted && typeof uid === "string" &&
          Number.isSafeInteger(data.startMillis) && data.startMillis! >= 0) {
        return { activityId: uid, startMillis: data.startMillis! };
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return null;
}

export async function latestEventMillis(
  firestore: FirestoreClient,
  babyUid: string,
): Promise<{ bottle: number | null; wet: number | null; dirty: number | null }> {
  const latest: { bottle: number | null; wet: number | null; dirty: number | null } = { bottle: null, wet: null, dirty: null };
  let pageToken: string | undefined;
  do {
    const page = await firestore.listPage<LatestActivity>(`babyData/babyUid_${babyUid}/dailyActions`, {
      pageSize: 300,
      pageToken,
      orderBy: "startMillis desc",
    });
    for (const { data } of page.documents) {
      if (!Number.isSafeInteger(data.startMillis) || data.startMillis! < 0) continue;
      if (data.type === "bottle" && latest.bottle === null) latest.bottle = data.startMillis!;
      if (data.type === "diaper_change" && (data.pee === 1 || data.pee === true) && latest.wet === null) latest.wet = data.startMillis!;
      if (data.type === "diaper_change" && (data.poo === 1 || data.poo === true) && latest.dirty === null) latest.dirty = data.startMillis!;
      if (latest.bottle !== null && latest.wet !== null && latest.dirty !== null) return latest;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return latest;
}

function validateEvent(value: unknown): GarminEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GarminRelayInputError();
  const event = value as Record<string, unknown>;
  const id = requiredSafeString(event.id, 128, true);
  const type = event.type;
  const startMillis = event.startMillis;
  if ((type !== "bottle" && type !== "diaper_change" && type !== "sleeping") ||
      typeof startMillis !== "number" || !Number.isSafeInteger(startMillis) || startMillis < 0) {
    throw new GarminRelayInputError();
  }
  if (type === "bottle") {
    if (event.volume !== undefined && (typeof event.volume !== "number" || !Number.isFinite(event.volume) || event.volume < 0 || event.volume > 5000)) {
      throw new GarminRelayInputError();
    }
    const bottleGroupUid = event.bottleGroupUid === undefined ? undefined : requiredSafeString(event.bottleGroupUid, 128, true);
    const milkType = event.milkType;
    if (milkType !== undefined && milkType !== "mothers_milk" && milkType !== "formula") throw new GarminRelayInputError();
    return { id, type, startMillis, ...(event.volume === undefined ? {} : { volume: event.volume }),
      ...(bottleGroupUid === undefined ? {} : { bottleGroupUid }), ...(milkType === undefined ? {} : { milkType }) };
  }
  if (type === "sleeping") {
    const activityId = event.activityId === undefined ? undefined : requiredSafeString(event.activityId, 128, true);
    if (typeof event.inProgress !== "boolean") throw new GarminRelayInputError();
    if (event.inProgress === false &&
      (typeof event.endMillis !== "number" || !Number.isSafeInteger(event.endMillis) || event.endMillis < startMillis ||
       typeof event.duration !== "number" || !Number.isSafeInteger(event.duration) || event.duration < 0)) {
      throw new GarminRelayInputError();
    }
    return { id, type, startMillis, inProgress: event.inProgress, ...(activityId ? { activityId } : {}),
      ...(event.endMillis === undefined ? {} : { endMillis: event.endMillis as number }),
      ...(event.duration === undefined ? {} : { duration: event.duration as number }) };
  }
  if (event.pee !== undefined && typeof event.pee !== "boolean") throw new GarminRelayInputError();
  if (event.poo !== undefined && typeof event.poo !== "boolean") throw new GarminRelayInputError();
  return { id, type, startMillis, pee: event.pee === true, poo: event.poo === true };
}

export function buildGarminEventDocument(
  event: GarminEvent,
  userUid: string,
  babyUid: string,
  updatedMillis: number,
  bottleGroupUid = "",
): Record<string, unknown> {
  const activity = buildPointActivity({
    uid: event.activityId ?? event.id,
    type: event.type,
    startMillis: event.startMillis,
    groupUid: event.type === "bottle" ? bottleGroupUid : "",
    volume: event.type === "bottle" ? (event.volume ?? 0) : 0,
    pee: event.type === "diaper_change" && event.pee,
    poo: event.type === "diaper_change" && event.poo,
  }, { userUid, babyUid, updatedMillis });
  return encodeDailyAction({
    ...activity,
    ...(event.type === "sleeping" ? {
      inProgress: event.inProgress ?? true,
      endMillis: event.endMillis ?? 0,
      duration: event.duration ?? 0,
    } : {}),
  });
}

async function listBottleGroups(firestore: FirestoreClient, babyUid: string): Promise<GarminBottleGroup[]> {
  const groups = await firestore.list<{ uid?: string; title?: string; messageKey?: string; daType?: string; deleted?: boolean }>(`babyData/babyUid_${babyUid}/groups`);
  return groups.flatMap(({ data }) => data.daType === "bottle" && !data.deleted && data.uid
    ? [{
      uid: data.uid,
      title: data.title ?? data.messageKey ?? "Milk",
      messageKey: data.messageKey || inferBottleMessageKey(data.title ?? ""),
    }]
    : []);
}

export function inferBottleMessageKey(title: string): string {
  const normalized = title.trim().toLocaleLowerCase("en-US");
  if (normalized.includes("formula")) return "formula";
  if (normalized.includes("mother")) return "mothers_milk";
  return "";
}

function resolveBottleGroupUid(event: GarminEvent, groups: readonly GarminBottleGroup[]): string {
  if (event.bottleGroupUid) {
    if (groups.some(({ uid }) => uid === event.bottleGroupUid)) return event.bottleGroupUid;
    throw new GarminRelayInputError();
  }
  if (event.milkType) {
    const match = groups.find(({ messageKey }) => messageKey === event.milkType);
    if (match) return match.uid;
    throw new GarminRelayInputError();
  }
  return groups[0]?.uid ?? "";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new GarminRelayInputError();
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GarminRelayInputError();
  }
}

function requiredSafeString(value: unknown, maxLength: number, safeId: boolean): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || (safeId && !SAFE_ID.test(value))) {
    throw new GarminRelayInputError();
  }
  return value;
}

function relayErrorStatus(error: unknown): number {
  if (error instanceof GarminRelayInputError) return 400;
  if (error instanceof BabyDaybookAuthError) return 401;
  if (error instanceof BabyDaybookApiError && (error.status === 401 || error.status === 403)) return 403;
  return 502;
}

function relayErrorCode(status: number): string {
  if (status === 400) return "invalid_request";
  if (status === 401) return "invalid_token";
  if (status === 403) return "forbidden";
  return "upstream_error";
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

class GarminRelayInputError extends Error {}
