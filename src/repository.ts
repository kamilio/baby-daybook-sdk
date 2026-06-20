import type { FirestoreClient } from "./firestore.js";
import type { CloudRecord, ListOptions, SaveOptions } from "./types.js";

export class CollectionRepository<T extends CloudRecord> {
  readonly firestore: FirestoreClient;
  readonly collectionPath: string;
  readonly idField: keyof T | undefined;

  constructor(firestore: FirestoreClient, collectionPath: string, idField: keyof T | undefined = "uid" as keyof T) {
    this.firestore = firestore;
    this.collectionPath = collectionPath;
    this.idField = idField;
  }

  async list(options: ListOptions = {}): Promise<T[]> {
    return (await this.firestore.list<T>(this.collectionPath, options)).map((document) => this.#withId(document.id, document.data));
  }

  async get(id: string): Promise<T | undefined> {
    const document = await this.firestore.get<T>(`${this.collectionPath}/${id}`);
    return document ? this.#withId(document.id, document.data) : undefined;
  }

  async save(item: T, options: SaveOptions = {}): Promise<T> {
    const id = this.#id(item);
    const saved = await this.firestore.set(`${this.collectionPath}/${id}`, item as Record<string, unknown>, {
      merge: options.merge ?? true,
      serverTimestamp: options.serverTimestamp,
    });
    return this.#withId(id, saved.data as T);
  }

  async softDelete(id: string): Promise<T> {
    const current = await this.get(id);
    if (!current) throw new Error(`Record ${id} does not exist in ${this.collectionPath}`);
    return this.save({ ...current, deleted: true }, { merge: true });
  }

  hardDelete(id: string): Promise<void> {
    return this.firestore.delete(`${this.collectionPath}/${id}`);
  }

  #id(item: T): string {
    if (!this.idField) throw new Error(`Repository ${this.collectionPath} requires an explicit document ID`);
    const id = item[this.idField];
    if (typeof id !== "string" || !id) throw new Error(`Missing ${String(this.idField)} for ${this.collectionPath}`);
    return id;
  }

  #withId(id: string, item: T): T {
    if (!this.idField || item[this.idField] !== undefined) return item;
    return { ...item, [this.idField]: id };
  }
}
