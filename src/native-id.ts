export function createNativeRandomUid(length = 16): string {
  if (!Number.isSafeInteger(length) || length < 1 || length > 128) throw new RangeError("Native UID length must be between 1 and 128");
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - result.length));
    for (const byte of bytes) {
      if (byte >= 248) continue;
      result += alphabet[byte % alphabet.length];
    }
  }
  return result;
}
