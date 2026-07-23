export type NativeBooleanFlag = boolean | 0 | 1;

export function isNativeTrue(value: unknown): boolean {
  return value === true || value === 1;
}

export function normalizeNativeFlag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new TypeError(`Native boolean flag must be true, false, 1, or 0; received ${String(value)}`);
}

export function encodeNativeFlag(value: unknown): 0 | 1 | undefined {
  const normalized = normalizeNativeFlag(value);
  return normalized === undefined ? undefined : normalized ? 1 : 0;
}

export function encodeNativeFlagFields<T extends object, K extends keyof T>(
  record: T,
  fields: readonly K[],
): Record<string, unknown> {
  const encoded = { ...record } as Record<string, unknown>;
  for (const field of fields) {
    const key = String(field);
    if (!Object.hasOwn(record, field)) {
      delete encoded[key];
      continue;
    }
    // Keep an explicitly undefined property. Firestore merge writes include it
    // in the update mask while omitting it from encoded fields, which deletes
    // the remote value.
    encoded[key] = encodeNativeFlag(record[field]);
  }
  return encoded;
}
