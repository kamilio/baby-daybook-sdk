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
    }, (url, init) => {
      expect(url).toContain("accounts:signInWithIdp");
      const body = JSON.parse(String(init?.body));
      expect(body.postBody).toContain("providerId=apple.com");
      expect(body.postBody).toContain("id_token=apple-token");
      expect(body.postBody).toContain("nonce=raw-nonce");
      return response();
    });
    const auth = new BabyDaybookAuth({ fetch });
    await auth.signUpWithEmail("a@example.com", "secret");
    await auth.signInWithCustomToken("custom");
    await auth.signInWithOAuthCredential({ provider: "google.com", idToken: "google-token" });
    await auth.signInWithAppleCredential("apple-token", "raw-nonce");
    expect(fetch).toHaveBeenCalledTimes(4);
    await expect(auth.signInWithAppleCredential("", "nonce")).rejects.toThrow("Apple ID token must not be empty");
    await expect(auth.signInWithAppleCredential("token", "")).rejects.toThrow("Apple raw nonce must not be empty");
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
    const onSessionChanged = vi.fn();
    const fetch = mockFetch(
      jsonResponse({ users: [{ localId: "user" }] }),
      jsonResponse({ localId: "user", displayName: "Name" }),
      jsonResponse({}),
      jsonResponse({}),
    );
    const auth = new BabyDaybookAuth({ fetch, onSessionChanged });
    const session = auth.fromSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 });
    await expect(auth.getAccount(session)).resolves.toMatchObject({ localId: "user" });
    await expect(auth.updateAccount(session, { displayName: "Name" })).resolves.toMatchObject({ displayName: "Name" });
    expect(session.snapshot.displayName).toBe("Name");
    expect(onSessionChanged).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Name" }));
    await auth.sendPasswordResetEmail("a@example.com");
    await auth.sendEmailVerification(session);
  });

  it("links email and password while rotating the existing Apple session", async () => {
    const onSessionChanged = vi.fn();
    const fetch = mockFetch((url, init) => {
      expect(url).toContain("accounts:update");
      expect(JSON.parse(String(init?.body))).toEqual({
        idToken: "apple-firebase-token",
        email: "parent@example.com",
        password: "secret1",
        returnSecureToken: true,
      });
      return jsonResponse({
        localId: "apple-user",
        email: "parent@example.com",
        providerUserInfo: [{ providerId: "apple.com" }, { providerId: "password" }],
        idToken: "linked-token",
        refreshToken: "linked-refresh",
        expiresIn: "3600",
      });
    });
    const auth = new BabyDaybookAuth({ fetch, onSessionChanged });
    const session = auth.fromSession({
      idToken: "apple-firebase-token",
      refreshToken: "apple-refresh",
      userId: "apple-user",
      expiresAt: Date.now() + 3600_000,
    });

    const account = await auth.linkEmailPassword(session, " parent@example.com ", "secret1");
    expect(account).toMatchObject({
      localId: "apple-user",
      email: "parent@example.com",
    });
    expect(account).not.toHaveProperty("idToken");
    expect(account).not.toHaveProperty("refreshToken");
    expect(session.snapshot).toMatchObject({
      idToken: "linked-token",
      refreshToken: "linked-refresh",
      userId: "apple-user",
      email: "parent@example.com",
    });
    expect(onSessionChanged).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "linked-refresh" }));
    await expect(auth.linkEmailPassword(session, " ", "secret1")).rejects.toThrow("Email must not be empty");
    await expect(auth.linkEmailPassword(session, "parent@example.com", "short")).rejects.toThrow("at least 6 characters");
  });

  it("signs out idempotently and prevents later token use", async () => {
    const onSessionChanged = vi.fn();
    const auth = new BabyDaybookAuth({ onSessionChanged });
    const session = auth.fromSession({ idToken: "id", refreshToken: "refresh", userId: "user", expiresAt: Date.now() + 3_600_000 });
    await auth.signOut(session);
    await auth.signOut(session);
    expect(session.signedOut).toBe(true);
    expect(session.snapshot).toMatchObject({ idToken: "", expiresAt: 0 });
    expect(session.snapshot.refreshToken).toBeUndefined();
    expect(onSessionChanged).toHaveBeenCalledOnce();
    expect(onSessionChanged).toHaveBeenCalledWith(undefined);
    await expect(session.getIdToken()).rejects.toMatchObject({ code: "SIGNED_OUT" });
    await expect(session.updateProfile({ displayName: "Nope" })).rejects.toMatchObject({ code: "SIGNED_OUT" });
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
