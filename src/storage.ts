import { BabyDaybookApiError } from "./errors.js";
import type { AuthSession } from "./auth.js";
import type { AttachmentCategory } from "./types.js";
import { babyDocumentId } from "./paths.js";

export class FirebaseStorageClient {
  readonly session: AuthSession;

  constructor(session: AuthSession) {
    this.session = session;
  }

  attachmentPath(category: AttachmentCategory, babyUid: string, itemUid: string, fileName: string): string {
    return `files/${category}/${babyDocumentId(babyUid)}/${itemUid}/${fileName}`;
  }

  attachmentThumbnailPath(category: AttachmentCategory, babyUid: string, itemUid: string, fileName: string): string {
    return this.attachmentPath(category, babyUid, itemUid, thumbnailFileName(fileName));
  }

  async downloadAttachment(
    category: AttachmentCategory,
    babyUid: string,
    itemUid: string,
    fileName: string,
    preferThumbnail = false,
  ): Promise<Uint8Array> {
    const originalPath = this.attachmentPath(category, babyUid, itemUid, originalFileName(fileName));
    if (!preferThumbnail) return this.download(originalPath);
    try {
      return await this.download(this.attachmentThumbnailPath(category, babyUid, itemUid, fileName));
    } catch (error) {
      if (!(error instanceof BabyDaybookApiError) || error.status !== 404) throw error;
      return this.download(originalPath);
    }
  }

  async deleteAttachment(category: AttachmentCategory, babyUid: string, itemUid: string, fileName: string): Promise<void> {
    const original = this.attachmentPath(category, babyUid, itemUid, originalFileName(fileName));
    const thumbnail = this.attachmentThumbnailPath(category, babyUid, itemUid, fileName);
    await this.#deleteIfExists(original);
    await this.#deleteIfExists(thumbnail);
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

  async #deleteIfExists(path: string): Promise<void> {
    try {
      await this.delete(path);
    } catch (error) {
      if (!(error instanceof BabyDaybookApiError) || error.status !== 404) throw error;
    }
  }

  #baseUrl(): string {
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.session.config.storageBucket)}/o`;
  }
}

function thumbnailFileName(fileName: string): string {
  return fileName.startsWith("thumb_") ? fileName : `thumb_${fileName}`;
}

function originalFileName(fileName: string): string {
  return fileName.startsWith("thumb_") ? fileName.slice("thumb_".length) : fileName;
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
