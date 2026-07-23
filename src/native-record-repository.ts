import { CollectionRepository } from "./repository.js";
import type { FirestoreClient } from "./firestore.js";
import type { CloudRecord, ListOptions, SaveOptions } from "./types.js";

export interface NativeRecordCodec<T extends CloudRecord> {
  decode(record: T): T;
  encode(record: T): Record<string, unknown>;
}

export class NativeRecordRepository<T extends CloudRecord> extends CollectionRepository<T> {
  readonly codec: NativeRecordCodec<T>;

  constructor(
    firestore: FirestoreClient,
    collectionPath: string,
    codec: NativeRecordCodec<T>,
    idField: keyof T | undefined = "uid" as keyof T,
  ) {
    super(firestore, collectionPath, idField);
    this.codec = codec;
  }

  override async list(options: ListOptions = {}): Promise<T[]> {
    return (await super.list(options)).map((record) => this.codec.decode(record));
  }

  override async get(id: string): Promise<T | undefined> {
    const record = await super.get(id);
    return record === undefined ? undefined : this.codec.decode(record);
  }

  override async save(record: T, options: SaveOptions = {}): Promise<T> {
    const saved = await super.save(this.codec.encode(record) as T, options);
    return this.codec.decode(saved);
  }
}
