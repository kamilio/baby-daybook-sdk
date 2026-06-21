import type { AppleCredential } from "./auth.js";

export const BABY_DAYBOOK_APPLE_CLIENT_ID = "babydaybook.com";
export const BABY_DAYBOOK_APPLE_REDIRECT_URI =
  "https://us-central1-baby-daybook-app.cloudfunctions.net/signInWithAppleAndroid";

export interface AppleAuthorizationOptions {
  scopes?: readonly ("email" | "name")[];
  state?: string;
}

export function createAppleAuthorizationUrl(options: AppleAuthorizationOptions = {}): URL {
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", BABY_DAYBOOK_APPLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", BABY_DAYBOOK_APPLE_REDIRECT_URI);
  url.searchParams.set("scope", (options.scopes ?? ["email", "name"]).join(" "));
  url.searchParams.set("response_type", "code id_token");
  url.searchParams.set("response_mode", "form_post");
  if (options.state) url.searchParams.set("state", options.state);
  return url;
}

export function parseAppleCallbackUrl(callbackUrl: string | URL): AppleCredential {
  const url = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl.trim());
  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description");
    throw new Error(description ? `Apple authorization failed: ${error} (${description})` : `Apple authorization failed: ${error}`);
  }
  const idToken = requiredParameter(url, "id_token").trim();
  const authorizationCode = requiredParameter(url, "code").trim();
  if (!idToken) throw new Error("Apple callback ID token must not be empty");
  if (!authorizationCode) throw new Error("Apple callback authorization code must not be empty");
  return {
    idToken,
    authorizationCode,
  };
}

export function generateBabyDaybookPassword(bytes = 24): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16) throw new RangeError("Password entropy must be at least 16 bytes");
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(random).toString("base64url");
}

function requiredParameter(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null) throw new Error(`Apple callback is missing ${name}`);
  return value;
}
