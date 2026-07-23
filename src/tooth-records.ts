import { encodeNativeFlagFields, normalizeNativeFlag } from "./native-flags.js";
import { NativeRecordRepository } from "./native-record-repository.js";
import type { FirestoreClient } from "./firestore.js";
import type { Tooth } from "./types.js";

const FLAG_FIELDS = ["erupted", "shed"] as const;

export class ToothRepository extends NativeRecordRepository<Tooth> {
  constructor(firestore: FirestoreClient, collectionPath: string) {
    super(firestore, collectionPath, {
      decode: (tooth) => {
        const decoded = { ...tooth };
        for (const field of FLAG_FIELDS) {
          const value = normalizeNativeFlag(tooth[field]);
          if (value === undefined) delete decoded[field];
          else decoded[field] = value;
        }
        return decoded;
      },
      encode: (tooth) => encodeNativeFlagFields(tooth, FLAG_FIELDS),
    });
  }
}
