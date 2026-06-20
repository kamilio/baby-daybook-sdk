import { BabyDaybookApiError } from "./errors.js";
import type { AuthSession } from "./auth.js";
import type { AttachmentCategory } from "./types.js";

export class FirebaseStorageClient {
  readonly session: AuthSession;

  constructor(session: AuthSession) {
    this.session = session;
  }

  attachmentPath(category: AttachmentCategory, babyUid: string, itemUid: string, fileName: string): string {
    return `files/${category}/babyUid_${babyUid}/${itemUid}/${fileName}`;
  }

  async upload(path: string, body: BodyInit, contentType = "application/octet-stream"): Promise<Record<string, unknown>> {
    const url = new URL(this.#baseUrl());
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", path);
    const response = await this.session.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.session.getIdToken()}`, "content-type": contentType },
      body,
    });
    return parseStorageResponse(response);
  }

  async download(path: string): Promise<Uint8Array> {
    const url = new URL(`${this.#baseUrl()}/${encodeURIComponent(path)}`);
    url.searchParams.set("alt", "media");
    const response = await this.session.fetch(url, { headers: { authorization: `Bearer ${await this.session.getIdToken()}` } });
    if (!response.ok) await throwStorageError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const response = await this.session.fetch(`${this.#baseUrl()}/${encodeURIComponent(path)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await this.session.getIdToken()}` },
    });
    if (!response.ok) await throwStorageError(response);
  }

  #baseUrl(): string {
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.session.config.storageBucket)}/o`;
  }
}

async function parseStorageResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) await throwStorageError(response);
  return response.json() as Promise<Record<string, unknown>>;
}

async function throwStorageError(response: Response): Promise<never> {
  const text = await response.text();
  let details: unknown = text;
  try { details = JSON.parse(text); } catch { details = text; }
  throw new BabyDaybookApiError(`Firebase Storage request failed with ${response.status}`, { status: response.status, details });
}
