import { encodeNativeFlagFields, normalizeNativeFlag } from "./native-flags.js";
import type { Baby } from "./types.js";

const FLAG_FIELDS = ["isPremature", "convertUnits", "sleepPredictionEnabled"] as const;

export function decodeBaby(record: Baby): Baby {
  const decoded = { ...record };
  for (const field of FLAG_FIELDS) {
    const value = normalizeNativeFlag(record[field]);
    if (value === undefined) delete decoded[field];
    else decoded[field] = value;
  }
  return decoded;
}

export function encodeBaby(record: Baby): Record<string, unknown> {
  return encodeNativeFlagFields(record, FLAG_FIELDS);
}
