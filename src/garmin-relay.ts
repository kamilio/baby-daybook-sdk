import type { IncomingMessage, ServerResponse } from "node:http";
import { BabyDaybookAuth } from "./auth.js";
import { BabyDaybookApiError, BabyDaybookAuthError } from "./errors.js";
import { FirestoreClient } from "./firestore.js";
import type { FetchLike } from "./types.js";

const MAX_BODY_BYTES = 48 * 1024;
const MAX_EVENTS = 10;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

interface GarminEvent {
  id: string;
  type: "bottle" | "diaper_change";
  startMillis: number;
  volume?: number;
  pee?: boolean;
  poo?: boolean;
}

interface GarminSyncRequest {
  refreshToken: string;
  babyUid: string;
  events: GarminEvent[];
}

export async function handleGarminSync(
  request: IncomingMessage,
  response: ServerResponse,
  fetch: FetchLike = globalThis.fetch,
): Promise<void> {
  try {
    const input = validateSyncRequest(await readJsonBody(request));
    const session = await new BabyDaybookAuth({ fetch }).fromRefreshToken(input.refreshToken);
    const firestore = new FirestoreClient(session);
    const updatedMillis = Date.now();
    const writableEvents = await eventsNotDeletedUpstream(firestore, input.babyUid, input.events);
    const bottleGroupUid = writableEvents.some(({ type }) => type === "bottle")
      ? await firstBottleGroupUid(firestore, input.babyUid)
      : "";
    await firestore.setMany(writableEvents.map((event) => ({
      path: `babyData/babyUid_${input.babyUid}/dailyActions/${event.id}`,
      data: buildGarminEventDocument(event, session.userId, input.babyUid, updatedMillis, bottleGroupUid),
    })));
    const latest = await latestEventMillis(firestore, input.babyUid);
    sendJson(response, 200, {
      ok: true,
      acked: input.events.map(({ id }) => id),
      latest,
      refreshToken: session.snapshot.refreshToken,
      userId: session.userId,
    });
  } catch (error) {
    const status = relayErrorStatus(error);
    sendJson(response, status, { ok: false, error: relayErrorCode(status) });
  }
}

export async function eventsNotDeletedUpstream(
  firestore: Pick<FirestoreClient, "get">,
  babyUid: string,
  events: readonly GarminEvent[],
): Promise<GarminEvent[]> {
  const decisions = await Promise.all(events.map(async (event) => {
    const existing = await firestore.get<{ deleted?: boolean | number }>(
      `babyData/babyUid_${babyUid}/dailyActions/${event.id}`,
    );
    return existing?.data.deleted === true || existing?.data.deleted === 1 ? undefined : event;
  }));
  return decisions.filter((event): event is GarminEvent => event !== undefined);
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
  return { refreshToken, babyUid, events };
}

interface LatestActivity {
  type?: string;
  startMillis?: number;
  pee?: number | boolean;
  poo?: number | boolean;
  deleted?: boolean | number;
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
  if ((type !== "bottle" && type !== "diaper_change") ||
      typeof startMillis !== "number" || !Number.isSafeInteger(startMillis) || startMillis < 0) {
    throw new GarminRelayInputError();
  }
  if (type === "bottle") {
    if (event.volume !== undefined && (typeof event.volume !== "number" || !Number.isFinite(event.volume) || event.volume < 0 || event.volume > 5000)) {
      throw new GarminRelayInputError();
    }
    return { id, type, startMillis, ...(event.volume === undefined ? {} : { volume: event.volume }) };
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
  return {
    uid: event.id,
    userUid,
    babyUid,
    type: event.type,
    startMillis: event.startMillis,
    updatedMillis,
    rev: 4,
    groupUid: event.type === "bottle" ? bottleGroupUid : "",
    notes: "",
    inProgress: 0,
    endMillis: 0,
    duration: 0,
    pauseMillis: 0,
    leftDuration: 0,
    rightDuration: 0,
    side: "",
    reaction: "",
    amount: 0,
    amountUnit: "",
    temperature: 0,
    hairWash: 0,
    volume: event.type === "bottle" ? (event.volume ?? 0) : 0,
    pee: event.type === "diaper_change" && event.pee ? 1 : 0,
    poo: event.type === "diaper_change" && event.poo ? 1 : 0,
  };
}

async function firstBottleGroupUid(firestore: FirestoreClient, babyUid: string): Promise<string> {
  const groups = await firestore.list<{ uid?: string; daType?: string; deleted?: boolean }>(`babyData/babyUid_${babyUid}/groups`);
  return groups.find(({ data }) => data.daType === "bottle" && !data.deleted)?.data.uid ?? "";
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
