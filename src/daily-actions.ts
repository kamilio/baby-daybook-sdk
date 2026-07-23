import { encodeNativeFlagFields, normalizeNativeFlag } from "./native-flags.js";
import { NativeRecordRepository } from "./native-record-repository.js";
import { createNativeRandomUid } from "./native-id.js";
import type { FirestoreClient } from "./firestore.js";
import type { DailyAction, LoggedActivity, LogActivityInput } from "./types.js";

const FLAG_FIELDS = ["inProgress", "pee", "poo", "hairWash"] as const;

export class DailyActionRepository extends NativeRecordRepository<DailyAction> {
  constructor(firestore: FirestoreClient, collectionPath: string) {
    super(firestore, collectionPath, {
      decode: decodeDailyAction,
      encode: encodeDailyAction,
    });
  }
}

export function buildPointActivity(
  input: Readonly<LogActivityInput>,
  context: Readonly<{ userUid: string; babyUid: string; updatedMillis?: number }>,
): LoggedActivity {
  const type = input.type.trim();
  if (!type) throw new RangeError("Activity type must not be empty");
  const startMillis = input.startMillis ?? Date.now();
  const updatedMillis = context.updatedMillis ?? Date.now();
  assertTimestamp(startMillis, "Activity time");
  assertOptionalNonNegative(input.volume, "Activity volume", 5_000);
  assertOptionalNonNegative(input.amount, "Activity amount");
  assertOptionalFinite(input.temperature, "Activity temperature");
  return {
    uid: input.uid ?? createNativeRandomUid(32),
    userUid: context.userUid,
    babyUid: context.babyUid,
    type,
    startMillis,
    updatedMillis,
    rev: 4,
    groupUid: input.groupUid ?? "",
    notes: input.notes ?? "",
    inProgress: false,
    endMillis: 0,
    duration: 0,
    pauseMillis: 0,
    leftDuration: 0,
    rightDuration: 0,
    side: input.side ?? "",
    reaction: input.reaction ?? "",
    amount: input.amount ?? 0,
    amountUnit: input.amountUnit ?? "",
    temperature: input.temperature ?? 0,
    hairWash: input.hairWash ?? false,
    volume: input.volume ?? 0,
    pee: input.pee ?? false,
    poo: input.poo ?? false,
  };
}

export function decodeDailyAction(record: DailyAction): DailyAction {
  const decoded = { ...record };
  for (const field of FLAG_FIELDS) {
    const value = normalizeNativeFlag(record[field]);
    if (value === undefined) delete decoded[field];
    else decoded[field] = value;
  }
  return decoded;
}

export function encodeDailyAction(record: DailyAction): Record<string, unknown> {
  return encodeNativeFlagFields(record, FLAG_FIELDS);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer timestamp`);
}

function assertOptionalNonNegative(value: number | undefined, label: string, maximum = Number.POSITIVE_INFINITY): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > maximum)) {
    throw new RangeError(`${label} must be between 0 and ${maximum}`);
  }
}

function assertOptionalFinite(value: number | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
