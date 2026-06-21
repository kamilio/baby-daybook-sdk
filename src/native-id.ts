export function createNativeRandomUid(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (result.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(16 - result.length));
    for (const byte of bytes) {
      if (byte >= 248) continue;
      result += alphabet[byte % alphabet.length];
    }
  }
  return result;
}
