import { describe, expect, it, vi } from "vitest";
import { AuthSession, BabyDaybookAuth, BabyDaybookAuthError } from "../src/index.js";
import { jsonResponse, jwt, mockFetch } from "./helpers.js";

describe("BabyDaybookAuth", () => {
  it("signs in with email and emits the persisted session", async () => {
    const onSessionChanged = vi.fn();
    const fetch = mockFetch((url, init) => {
      expect(url).toContain("accounts:signInWithPassword");
      expect(JSON.parse(String(init?.body))).toEqual({ email: "a@example.com", password: "secret", returnSecureToken: true });
      return jsonResponse({ idToken: "id", refreshToken: "refresh", localId: "user", email: "a@example.com", expiresIn: "3600" });
    });
    const auth = new BabyDaybookAuth({ fetch, onSessionChanged });
    const session = await auth.signInWithEmail("a@example.com", "secret");
    expect(session.userId).toBe("user");
    expect(session.snapshot.refreshToken).toBe("refresh");
    expect(onSessionChanged).toHaveBeenCalledOnce();
  });

  it("supports sign-up, custom tokens, and OAuth credentials", async () => {
    const response = () => jsonResponse({ idToken: "id", refreshToken: "refresh", localId: "user", expiresIn: "3600" });
    const fetch = mockFetch(response(), response(), (url, init) => {
      expect(url).toContain("accounts:signInWithIdp");
      const body = JSON.parse(String(init?.body));
      expect(body.postBody).toContain("providerId=google.com");
      expect(body.postBody).toContain("id_token=google-token");
      return response();
    });
    const auth = new BabyDaybookAuth({ fetch });
    await auth.signUpWithEmail("a@example.com", "secret");
    await auth.signInWithCustomToken("custom");
    await auth.signInWithOAuthCredential({ provider: "google.com", idToken: "google-token" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refreshes an expired token once for concurrent callers", async () => {
    const onSessionChanged = vi.fn();
    const fetch = mockFetch(jsonResponse({ id_token: "fresh", refresh_token: "next", user_id: "user", expires_in: "3600" }));
    const session = new AuthSession({ idToken: "old", refreshToken: "refresh", userId: "user", expiresAt: 0 }, { fetch, onSessionChanged });
    await expect(Promise.all([session.getIdToken(), session.getIdToken()])).resolves.toEqual(["fresh", "fresh"]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(onSessionChanged).toHaveBeenCalledOnce();
  });

  it("constructs ID-token sessions and rejects expired non-refreshable sessions", async () => {
    const auth = new BabyDaybookAuth();
    const token = jwt({ user_id: "decoded", exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(auth.fromIdToken(token).userId).toBe("decoded");
    const expired = auth.fromSession({ idToken: "old", userId: "user", expiresAt: 0 });
    await expect(expired.getIdToken()).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(() => auth.fromIdToken("invalid")).toThrow(BabyDaybookAuthError);
  });

  it("loads and updates accounts and sends account emails", async () => {
    const fetch = mockFetch(
      jsonResponse({ users: [{ localId: "user" }] }),
      jsonResponse({ localId: "user", displayName: "Name" }),
      jsonResponse({}),
      jsonResponse({}),
    );
    const auth = new BabyDaybookAuth({ fetch });
    const session = auth.fromSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 });
    await expect(auth.getAccount(session)).resolves.toMatchObject({ localId: "user" });
    await expect(auth.updateAccount(session, { displayName: "Name" })).resolves.toMatchObject({ displayName: "Name" });
    await auth.sendPasswordResetEmail("a@example.com");
    await auth.sendEmailVerification(session);
  });

  it("rejects an empty account lookup", async () => {
    const auth = new BabyDaybookAuth({ fetch: mockFetch(jsonResponse({ users: [] })) });
    const session = auth.fromSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 });
    await expect(auth.getAccount(session)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("normalizes Firebase errors", async () => {
    const auth = new BabyDaybookAuth({ fetch: mockFetch(jsonResponse({ error: { message: "INVALID_PASSWORD" } }, 400)) });
    await expect(auth.signInWithEmail("a@example.com", "bad")).rejects.toMatchObject({
      name: "BabyDaybookAuthError",
      status: 400,
      message: "INVALID_PASSWORD",
    });
  });
});
