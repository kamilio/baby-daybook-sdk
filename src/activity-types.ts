import { encodeNativeFlagFields, normalizeNativeFlag } from "./native-flags.js";
import { NativeRecordRepository } from "./native-record-repository.js";
import type { FirestoreClient } from "./firestore.js";
import type { ActivityType, ActivityTypeView, BuiltInActivityType } from "./types.js";

const FLAG_FIELDS = ["hasDuration", "hasAmount", "hasReaction"] as const;

export const BUILT_IN_ACTIVITY_TYPE_DISPLAY_TITLES: Readonly<Record<BuiltInActivityType, string>> = Object.freeze({
  breastfeeding: "Breastfeeding",
  bottle: "Bottle",
  diaper_change: "Diaper change",
  sleeping: "Sleep",
  food: "Food",
  pump: "Pump",
  drink: "Drink",
  bath: "Bath",
  potty: "Potty",
  toothbrushing: "Toothbrushing",
  medicine: "Medicine",
  temperature: "Temperature",
  doctor_visit: "Doctor visit",
  vaccination: "Vaccination",
  symptom: "Symptom",
  crying: "Crying",
  tummy_time: "Tummy time",
  walking_outside: "Walking outside",
  playtime: "Playtime",
  other: "Other",
});

export function resolveActivityTypeDisplayTitle(
  activityType: string | Readonly<Pick<ActivityType, "uid"> & Partial<Pick<ActivityType, "title">>>,
): string {
  const uid = typeof activityType === "string" ? activityType : activityType.uid;
  const storedTitle = typeof activityType === "string" ? "" : activityType.title?.trim();
  if (storedTitle) return storedTitle;
  return Object.hasOwn(BUILT_IN_ACTIVITY_TYPE_DISPLAY_TITLES, uid)
    ? BUILT_IN_ACTIVITY_TYPE_DISPLAY_TITLES[uid as BuiltInActivityType]
    : uid;
}

export function withActivityTypeDisplayTitle(activityType: Readonly<ActivityType>): ActivityTypeView {
  return {
    ...activityType,
    displayTitle: resolveActivityTypeDisplayTitle(activityType),
  };
}

export class ActivityTypeRepository extends NativeRecordRepository<ActivityType> {
  constructor(firestore: FirestoreClient, collectionPath: string) {
    super(firestore, collectionPath, {
      decode: decodeActivityType,
      encode: encodeActivityType,
    });
  }
}

export function decodeActivityType(activityType: ActivityType): ActivityType {
  const decoded = { ...activityType };
  for (const field of FLAG_FIELDS) {
    const value = normalizeNativeFlag(activityType[field]);
    if (value === undefined) delete decoded[field];
    else decoded[field] = value;
  }
  return decoded;
}

export function encodeActivityType(activityType: ActivityType): Record<string, unknown> {
  const encoded = encodeNativeFlagFields(activityType, FLAG_FIELDS);
  delete encoded.displayTitle;
  return encoded;
}
