import { describe, expect, it } from "vitest";
import {
  BABY_DAYBOOK_APPLE_CLIENT_ID,
  BABY_DAYBOOK_APPLE_REDIRECT_URI,
  createAppleAuthorizationUrl,
  generateBabyDaybookPassword,
  parseAppleCallbackUrl,
} from "../src/apple.js";

describe("Apple browser authentication", () => {
  it("recreates the Android app authorization request", () => {
    const url = createAppleAuthorizationUrl();
    expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: BABY_DAYBOOK_APPLE_CLIENT_ID,
      redirect_uri: BABY_DAYBOOK_APPLE_REDIRECT_URI,
      scope: "email name",
      response_type: "code id_token",
      response_mode: "form_post",
    });
  });

  it("supports an opaque state and selected scopes", () => {
    const url = createAppleAuthorizationUrl({ state: "opaque", scopes: ["email"] });
    expect(url.searchParams.get("state")).toBe("opaque");
    expect(url.searchParams.get("scope")).toBe("email");
  });

  it("parses the cloud function intent callback", () => {
    expect(parseAppleCallbackUrl(
      "intent://callback?code=apple-code&id_token=apple-token&state=state%0A%20%20#Intent;package=com.drillyapps.babydaybook;scheme=signinwithapple;end",
    )).toEqual({
      idToken: "apple-token",
      authorizationCode: "apple-code",
    });
  });

  it("reports callback errors and missing credentials", () => {
    expect(() => parseAppleCallbackUrl("intent://callback?error=access_denied&error_description=Cancelled"))
      .toThrow("Apple authorization failed: access_denied (Cancelled)");
    expect(() => parseAppleCallbackUrl("intent://callback?code=code")).toThrow("missing id_token");
    expect(() => parseAppleCallbackUrl("intent://callback?id_token=token")).toThrow("missing code");
  });

  it("generates URL-safe passwords with sufficient entropy", () => {
    const first = generateBabyDaybookPassword();
    const second = generateBabyDaybookPassword();
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
    expect(() => generateBabyDaybookPassword(15)).toThrow("at least 16 bytes");
  });
});
