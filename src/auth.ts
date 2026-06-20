import { BABY_DAYBOOK_CONFIG } from "./constants.js";
import { BabyDaybookAuthError } from "./errors.js";
import { jsonHeaders, requestJson } from "./http.js";
import type { AuthSessionData, AuthSessionSnapshot, BabyDaybookConfig, FetchLike } from "./types.js";

interface IdentityResponse {
  idToken: string;
  refreshToken?: string;
  localId: string;
  email?: string;
  displayName?: string;
  expiresIn: string;
}

interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: string;
}

export interface AuthOptions {
  config?: Partial<BabyDaybookConfig>;
  fetch?: FetchLike;
  onSessionChanged?: (session: AuthSessionSnapshot | undefined) => void | Promise<void>;
}

export interface FirebaseProviderInfo {
  providerId: string;
  federatedId?: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
  rawId?: string;
}

export interface FirebaseAccount {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  createdAt?: string;
  lastLoginAt?: string;
  providerUserInfo?: FirebaseProviderInfo[];
  validSince?: string;
  disabled?: boolean;
}

export interface OAuthCredential {
  provider: "google.com" | "facebook.com" | "apple.com";
  idToken?: string;
  accessToken?: string;
  nonce?: string;
  requestUri?: string;
}

export class AuthSession {
  #data: AuthSessionData;
  readonly config: BabyDaybookConfig;
  readonly fetch: FetchLike;
  readonly onSessionChanged?: AuthOptions["onSessionChanged"];
  #refreshPromise?: Promise<string>;
  #signedOut = false;

  constructor(data: AuthSessionData, options: AuthOptions = {}) {
    this.#data = { ...data };
    this.config = { ...BABY_DAYBOOK_CONFIG, ...options.config };
    this.fetch = options.fetch ?? globalThis.fetch;
    this.onSessionChanged = options.onSessionChanged;
  }

  get userId(): string {
    return this.#data.userId;
  }

  get signedOut(): boolean {
    return this.#signedOut;
  }

  get snapshot(): AuthSessionSnapshot {
    return { ...this.#data };
  }

  async getIdToken(forceRefresh = false): Promise<string> {
    if (this.#signedOut) throw new BabyDaybookAuthError("The Firebase session has been signed out", { code: "SIGNED_OUT" });
    if (!forceRefresh && this.#data.expiresAt - Date.now() > 60_000) return this.#data.idToken;
    if (!this.#data.refreshToken) {
      if (this.#data.expiresAt > Date.now()) return this.#data.idToken;
      throw new BabyDaybookAuthError("The Firebase ID token expired and no refresh token is available", { code: "TOKEN_EXPIRED" });
    }
    this.#refreshPromise ??= this.#refresh().finally(() => {
      this.#refreshPromise = undefined;
    });
    return this.#refreshPromise;
  }

  async signOut(): Promise<void> {
    if (this.#signedOut) return;
    this.#signedOut = true;
    this.#refreshPromise = undefined;
    this.#data = { ...this.#data, idToken: "", refreshToken: undefined, expiresAt: 0 };
    await this.onSessionChanged?.(undefined);
  }

  async updateProfile(update: Pick<AuthSessionData, "email" | "displayName">): Promise<void> {
    if (this.#signedOut) throw new BabyDaybookAuthError("The Firebase session has been signed out", { code: "SIGNED_OUT" });
    this.#data = { ...this.#data, ...update };
    await this.onSessionChanged?.(this.snapshot);
  }

  async #refresh(): Promise<string> {
    const response = await requestJson<RefreshResponse>(
      this.fetch,
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.#data.refreshToken! }),
      },
      BabyDaybookAuthError,
    );
    this.#data = {
      ...this.#data,
      idToken: response.id_token,
      refreshToken: response.refresh_token,
      userId: response.user_id,
      expiresAt: Date.now() + Number(response.expires_in) * 1000,
    };
    await this.onSessionChanged?.(this.snapshot);
    return this.#data.idToken;
  }
}

export class BabyDaybookAuth {
  readonly config: BabyDaybookConfig;
  readonly fetch: FetchLike;
  readonly onSessionChanged?: AuthOptions["onSessionChanged"];

  constructor(options: AuthOptions = {}) {
    this.config = { ...BABY_DAYBOOK_CONFIG, ...options.config };
    this.fetch = options.fetch ?? globalThis.fetch;
    this.onSessionChanged = options.onSessionChanged;
  }

  fromSession(data: AuthSessionData): AuthSession {
    return new AuthSession(data, this);
  }

  fromIdToken(idToken: string, userId = decodeFirebaseUserId(idToken), expiresAt = decodeJwtExpiration(idToken)): AuthSession {
    return this.fromSession({ idToken, userId, expiresAt });
  }

  async fromRefreshToken(refreshToken: string): Promise<AuthSession> {
    const session = this.fromSession({ idToken: "", refreshToken, userId: "", expiresAt: 0 });
    await session.getIdToken(true);
    return session;
  }

  async signInWithEmail(email: string, password: string): Promise<AuthSession> {
    return this.#identity("accounts:signInWithPassword", { email, password, returnSecureToken: true });
  }

  async signUpWithEmail(email: string, password: string): Promise<AuthSession> {
    return this.#identity("accounts:signUp", { email, password, returnSecureToken: true });
  }

  async signInWithCustomToken(token: string): Promise<AuthSession> {
    return this.#identity("accounts:signInWithCustomToken", { token, returnSecureToken: true });
  }

  async signInWithOAuthCredential(credential: OAuthCredential): Promise<AuthSession> {
    const postBody = new URLSearchParams({ providerId: credential.provider });
    if (credential.idToken) postBody.set("id_token", credential.idToken);
    if (credential.accessToken) postBody.set("access_token", credential.accessToken);
    if (credential.nonce) postBody.set("nonce", credential.nonce);
    return this.#identity("accounts:signInWithIdp", {
      postBody: postBody.toString(),
      requestUri: credential.requestUri ?? "http://localhost",
      returnIdpCredential: true,
      returnSecureToken: true,
    });
  }

  async getAccount(session: AuthSession): Promise<FirebaseAccount> {
    const response = await this.#request<{ users?: FirebaseAccount[] }>("accounts:lookup", {
      idToken: await session.getIdToken(),
    });
    const account = response.users?.[0];
    if (!account) throw new BabyDaybookAuthError("Firebase account was not found", { code: "USER_NOT_FOUND" });
    return account;
  }

  async updateAccount(session: AuthSession, update: { displayName?: string; photoUrl?: string; password?: string; email?: string }): Promise<FirebaseAccount> {
    const account = await this.#request<FirebaseAccount>("accounts:update", { idToken: await session.getIdToken(), ...update, returnSecureToken: false });
    if (update.displayName !== undefined || update.email !== undefined) {
      await session.updateProfile({
        displayName: update.displayName ?? session.snapshot.displayName,
        email: update.email ?? session.snapshot.email,
      });
    }
    return account;
  }

  signOut(session: AuthSession): Promise<void> {
    return session.signOut();
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    await this.#request("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email });
  }

  async sendEmailVerification(session: AuthSession): Promise<void> {
    await this.#request("accounts:sendOobCode", { requestType: "VERIFY_EMAIL", idToken: await session.getIdToken() });
  }

  async #identity(endpoint: string, body: Record<string, unknown>): Promise<AuthSession> {
    const response = await this.#request<IdentityResponse>(endpoint, body);
    const session = this.fromSession({
      idToken: response.idToken,
      refreshToken: response.refreshToken,
      userId: response.localId,
      email: response.email,
      displayName: response.displayName,
      expiresAt: Date.now() + Number(response.expiresIn) * 1000,
    });
    await this.onSessionChanged?.(session.snapshot);
    return session;
  }

  #request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    return requestJson<T>(
      this.fetch,
      `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(this.config.apiKey)}`,
      { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) },
      BabyDaybookAuthError,
    );
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function decodeFirebaseUserId(token: string): string {
  const payload = decodeJwtPayload(token);
  const userId = payload.user_id ?? payload.sub;
  if (typeof userId !== "string" || !userId) {
    throw new BabyDaybookAuthError("Could not determine the Firebase user ID from the ID token", { code: "INVALID_ID_TOKEN" });
  }
  return userId;
}

function decodeJwtExpiration(token: string): number {
  const expiration = decodeJwtPayload(token).exp;
  return typeof expiration === "number" ? expiration * 1000 : Date.now() + 55 * 60_000;
}
