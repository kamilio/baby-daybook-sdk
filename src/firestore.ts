import { BabyDaybookApiError } from "./errors.js";
import { jsonHeaders, requestJson } from "./http.js";
import type { AuthSession } from "./auth.js";
import type { BabyDaybookConfig, FirestoreDocument, ListOptions } from "./types.js";

type FirestoreValue = Record<string, unknown>;
interface FirestoreWireDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export class FirestoreClient {
  readonly session: AuthSession;
  readonly config: BabyDaybookConfig;
  readonly baseUrl: string;

  constructor(session: AuthSession) {
    this.session = session;
    this.config = session.config;
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents`;
  }

  async get<T>(path: string): Promise<FirestoreDocument<T> | undefined> {
    try {
      const document = await this.#request<FirestoreWireDocument>(this.#documentUrl(path));
      return decodeDocument<T>(document);
    } catch (error) {
      if (error instanceof BabyDaybookApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async list<T>(collectionPath: string, options: ListOptions = {}): Promise<FirestoreDocument<T>[]> {
    const documents: FirestoreDocument<T>[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${this.baseUrl}/${encodePath(collectionPath)}`);
      url.searchParams.set("pageSize", String(Math.min(Math.max(options.pageSize ?? 300, 1), 1000)));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.#request<{ documents?: FirestoreWireDocument[]; nextPageToken?: string }>(url.toString());
      documents.push(...(response.documents ?? []).map(decodeDocument<T>));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return options.includeDeleted ? documents : documents.filter((document) => !(document.data as any)?.deleted);
  }

  async set<T extends Record<string, unknown>>(path: string, data: T, options: { merge?: boolean; serverTimestamp?: boolean } = {}): Promise<FirestoreDocument<T>> {
    if (options.serverTimestamp !== false) {
      const fields = { ...data };
      delete fields.svt;
      const response = await this.#request<{ writeResults?: Array<{ updateTime?: string }>; commitTime?: string }>(
        `${this.baseUrl}:commit`,
        {
          method: "POST",
          headers: await this.#headers(),
          body: JSON.stringify({
            writes: [{
              update: { name: this.#documentName(path), fields: encodeFields(fields) },
              ...(options.merge ? { updateMask: { fieldPaths: Object.keys(fields) } } : {}),
              updateTransforms: [{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }],
            }],
          }),
        },
      );
      const result = await this.get<T>(path);
      if (result) return result;
      return { id: lastSegment(path), path, updateTime: response.writeResults?.[0]?.updateTime ?? response.commitTime, data };
    }

    const url = new URL(this.#documentUrl(path));
    if (options.merge) for (const field of Object.keys(data)) url.searchParams.append("updateMask.fieldPaths", field);
    const response = await this.#request<FirestoreWireDocument>(url.toString(), {
      method: "PATCH",
      headers: await this.#headers(),
      body: JSON.stringify({ fields: encodeFields(data) }),
    });
    return decodeDocument<T>(response);
  }

  async delete(path: string): Promise<void> {
    await this.#request(this.#documentUrl(path), { method: "DELETE", headers: await this.#headers() });
  }

  async #request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = init.headers ?? await this.#headers();
    return requestJson<T>(this.session.fetch, url, { ...init, headers });
  }

  async #headers(): Promise<Headers> {
    return jsonHeaders({ authorization: `Bearer ${await this.session.getIdToken()}` });
  }

  #documentUrl(path: string): string {
    return `${this.baseUrl}/${encodePath(path)}`;
  }

  #documentName(path: string): string {
    return `projects/${this.config.projectId}/databases/(default)/documents/${path}`;
  }
}

export function encodeFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encodeValue(value)]));
}

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "bigint") return { integerValue: value.toString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BabyDaybookApiError("Firestore does not support non-finite numbers");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Uint8Array) return { bytesValue: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new BabyDaybookApiError(`Unsupported Firestore value: ${typeof value}`);
}

export function decodeValue(value: FirestoreValue): any {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return Date.parse(String(value.timestampValue));
  if ("bytesValue" in value) return Uint8Array.from(Buffer.from(String(value.bytesValue), "base64"));
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) return ((value.arrayValue as any)?.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields((value.mapValue as any)?.fields ?? {});
  return undefined;
}

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function decodeDocument<T>(document: FirestoreWireDocument): FirestoreDocument<T> {
  const path = document.name.split("/documents/")[1] ?? document.name;
  return {
    id: lastSegment(path),
    path,
    createTime: document.createTime,
    updateTime: document.updateTime,
    data: decodeFields(document.fields ?? {}) as T,
  };
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function lastSegment(path: string): string {
  return path.split("/").at(-1) ?? path;
}
