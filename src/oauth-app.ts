import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  createAuthorizationInteractionSecurity,
  createHTTPMCPAuthorization,
  createOAuthAuthorizationServer,
  verifyAuthorizationInteractionCsrf,
  type OAuthAuthorizationServer,
  type ToolcraftHTTPContext,
} from "toolcraft/http";
import { createAppleAuthorizationUrl } from "./apple.js";
import { BabyDaybookClient } from "./client.js";
import type {
  BabyDaybookCommandConnection,
  BabyDaybookCommandService,
} from "./command-service.js";
import { createBabyDaybookHTTPMCPServer } from "./toolcraft-http.js";
import type { AuthSessionSnapshot, FetchLike } from "./types.js";
import { BabyDaybookOAuthDatabase } from "./oauth-store.js";

const APPLE_CALLBACK_MAX_BYTES = 32 * 1024;
const FORM_MAX_BYTES = APPLE_CALLBACK_MAX_BYTES + 4096;
const AUTHORIZATION_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/jwks.json",
  "/register",
  "/authorize",
  "/token",
  "/revoke",
]);

export interface BabyDaybookOAuthAppOptions {
  baseUrl: string;
  databasePath: string;
  encryptionKey: Uint8Array;
  signingPrivateKey: KeyObject;
  fetch?: FetchLike;
}

export interface BabyDaybookOAuthApp {
  server: Server;
  database: BabyDaybookOAuthDatabase;
  authorizationServer: OAuthAuthorizationServer;
  close(): Promise<void>;
}

export async function createBabyDaybookOAuthApp(options: BabyDaybookOAuthAppOptions): Promise<BabyDaybookOAuthApp> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const resource = `${baseUrl}/mcp`;
  const hostname = new URL(baseUrl).host;
  const database = new BabyDaybookOAuthDatabase(options.databasePath, options.encryptionKey);
  database.pruneExpired();
  const fetch = options.fetch ?? globalThis.fetch;
  const sessions = new OAuthBabyDaybookSessionManager(database, fetch);
  const rateLimiter = new RequestRateLimiter();

  const interaction = {
    start(context: Parameters<Parameters<typeof createOAuthAuthorizationServer>[0]["interaction"]["start"]>[0]): Response {
      const security = createAuthorizationInteractionSecurity();
      database.putInteraction(context.transaction.id, security.state, context.transaction.expiresAt);
      const appleUrl = createAppleAuthorizationUrl({ state: security.state });
      return htmlResponse(renderAuthorizationPage({
        appleUrl: appleUrl.href,
        csrfToken: security.csrfToken,
        transactionId: context.transaction.id,
        scopes: context.transaction.scopes,
      }), 200, { "set-cookie": security.setCookie });
    },
  };

  const authorizationServer = createOAuthAuthorizationServer({
    issuer: baseUrl,
    resources: [resource],
    signingKey: createSigningKey(options.signingPrivateKey),
    store: database,
    interaction,
    accessTokenTtlSeconds: 300,
    authorizationCodeTtlSeconds: 300,
    authorizationTransactionTtlSeconds: 600,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    maxRequestBodyBytes: 64 * 1024,
  });

  const unavailableService: BabyDaybookCommandService = {
    async connect() {
      throw new Error("Authenticated OAuth request context is required");
    },
  };
  const mcpAuthorization = createHTTPMCPAuthorization({
    authorizationServer,
    resource,
    requiredScopes: ["baby-daybook"],
    scopesSupported: ["baby-daybook", "offline_access"],
  });
  const mcpServer = await createBabyDaybookHTTPMCPServer({
    path: "/mcp",
    trustedProxy: true,
    allowedHosts: [hostname],
    sessionIdGenerator: undefined,
    maxRequestBytes: 4 * 1024 * 1024,
    maxBatchSize: 100,
    maxConcurrentToolCalls: 32,
    services: { babyDaybook: unavailableService },
    oauth: mcpAuthorization,
    requestServices(context: ToolcraftHTTPContext) {
      const subject = context.auth?.subject;
      if (!subject) throw new Error("Authenticated OAuth subject is required");
      return { babyDaybook: new OAuthBabyDaybookCommandService(sessions, subject) };
    },
  });

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", baseUrl).pathname;
      if (!rateLimiter.allow(request, pathname)) {
        response.writeHead(429, { "retry-after": "60", "cache-control": "no-store" });
        response.end();
        return;
      }
      if (pathname === "/mcp") {
        await mcpServer.handleRequest(request, response);
        return;
      }
      if ((pathname === "/.well-known/oauth-protected-resource/mcp" || pathname === "/.well-known/oauth-protected-resource")
        && request.method === "GET") {
        sendJson(response, 200, {
          resource,
          authorization_servers: mcpAuthorization.authorizationServers,
          bearer_methods_supported: mcpAuthorization.bearerMethodsSupported,
          scopes_supported: mcpAuthorization.scopesSupported,
        }, "public, max-age=300");
        return;
      }
      if (AUTHORIZATION_PATHS.has(pathname)) {
        await sendFetchResponse(response, await authorizationServer.handle(await toFetchRequest(request, baseUrl)));
        return;
      }
      if (pathname === "/interaction/apple" && request.method === "POST") {
        const context = { baseUrl, database, authorizationServer, fetch, encryptionKey: options.encryptionKey };
        try {
          await completeAppleAuthorization(request, response, context);
        } catch (error) {
          if (error instanceof AuthorizationInteractionError && error.transactionId
            && await restartAuthorization(response, context, error.transactionId, error.userMessage)) {
            console.warn("Baby Daybook OAuth interaction retry", { pathname, stage: error.stage });
            return;
          }
          throw error;
        }
        return;
      }
      if (pathname === "/interaction/email" && request.method === "POST") {
        await completeEmailAuthorization(request, response, { baseUrl, database, authorizationServer, fetch, encryptionKey: options.encryptionKey });
        return;
      }
      if (pathname === "/health" && request.method === "GET") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (pathname === "/" && request.method === "GET") {
        sendFetchResponse(response, htmlResponse(renderLandingPage(resource)));
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const pathname = new URL(request.url ?? "/", baseUrl).pathname;
      console.error("Baby Daybook OAuth request failed", {
        pathname,
        stage: error instanceof AuthorizationInteractionError ? error.stage : "request",
        error: error instanceof Error ? error.name : "UnknownError",
      });
      if (!response.headersSent) sendFetchResponse(response, htmlResponse(renderErrorPage(), 400));
      else response.destroy();
    }
  });

  return {
    server,
    database,
    authorizationServer,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      database.close();
    },
  };
}

export function importOAuthSigningPrivateKey(value: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
  } catch (error) {
    throw new Error("BABY_DAYBOOK_OAUTH_SIGNING_KEY must be a base64 PKCS#8 private key", { cause: error });
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("BABY_DAYBOOK_OAUTH_SIGNING_KEY must be an EC P-256 private key");
  }
  return key;
}

export function decodeSessionEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error("BABY_DAYBOOK_SESSION_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

interface CompletionContext {
  baseUrl: string;
  database: BabyDaybookOAuthDatabase;
  authorizationServer: OAuthAuthorizationServer;
  fetch: FetchLike;
  encryptionKey: Uint8Array;
}

async function completeAppleAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  context: CompletionContext,
): Promise<void> {
  let form: URLSearchParams;
  try {
    form = await readForm(request);
  } catch {
    throw new AuthorizationInteractionError("form", "The submitted form was invalid.");
  }
  const transactionId = form.get("transaction_id")?.trim();
  try {
    validateInteractionRequest(request, context.baseUrl, requiredFormValue(form, "csrf"));
  } catch {
    throw new AuthorizationInteractionError("csrf", "The authorization page expired. Restart the MCP connection.");
  }
  if (!transactionId) throw new AuthorizationInteractionError("transaction", "The authorization transaction is missing.");
  let callback: URL;
  try {
    callback = validateAppleCallback(requiredFormValue(form, "callback"), form.get("state") ?? "");
  } catch {
    throw new AuthorizationInteractionError(
      "callback",
      "The Apple callback was incomplete or belonged to another attempt. Open Apple sign-in again and paste the newly generated intent.",
      transactionId,
    );
  }
  const state = callback.searchParams.get("state") ?? "";
  if (!context.database.takeInteraction(transactionId, state)) {
    throw new AuthorizationInteractionError(
      "state",
      "This Apple callback was already used, expired, or belongs to another attempt. Open Apple sign-in again.",
      transactionId,
    );
  }
  let client: BabyDaybookClient;
  try {
    client = await BabyDaybookClient.signInWithAppleCallback(callback, { fetch: context.fetch });
  } catch {
    throw new AuthorizationInteractionError(
      "firebase",
      "Baby Daybook did not accept this one-time Apple callback. Open Apple sign-in again and paste the new intent; do not reuse the previous one.",
      transactionId,
    );
  }
  await finishAuthorization(client, transactionId, response, context);
}

async function completeEmailAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  context: CompletionContext,
): Promise<void> {
  const form = await readForm(request);
  validateInteractionRequest(request, context.baseUrl, requiredFormValue(form, "csrf"));
  const transactionId = requiredFormValue(form, "transaction_id");
  const state = requiredFormValue(form, "state");
  if (!context.database.takeInteraction(transactionId, state)) throw new Error("Authorization interaction is invalid or expired");
  const client = await BabyDaybookClient.signInWithEmail(
    requiredFormValue(form, "email"),
    requiredFormValue(form, "password"),
    { fetch: context.fetch },
  );
  await finishAuthorization(client, transactionId, response, context);
}

async function finishAuthorization(
  client: BabyDaybookClient,
  transactionId: string,
  response: ServerResponse,
  context: CompletionContext,
): Promise<void> {
  const refreshToken = client.session.snapshot.refreshToken;
  if (!refreshToken) throw new Error("Baby Daybook did not issue a refresh token");
  const subject = deriveOAuthSubject(client.session.userId, context.encryptionKey);
  context.database.saveBabyDaybookRefreshToken(subject, refreshToken);
  const result = await context.authorizationServer.completeAuthorization({ transactionId, subject });
  await sendFetchResponse(response, htmlResponse(renderCompletionPage(result.redirectUrl.href)));
}

class AuthorizationInteractionError extends Error {
  constructor(
    readonly stage: string,
    readonly userMessage: string,
    readonly transactionId?: string,
  ) {
    super(userMessage);
  }
}

async function restartAuthorization(
  response: ServerResponse,
  context: CompletionContext,
  transactionId: string,
  errorMessage: string,
): Promise<boolean> {
  const transaction = context.database.getAuthorizationTransaction(transactionId);
  if (!transaction || transaction.expiresAt <= Date.now()) return false;
  const security = createAuthorizationInteractionSecurity();
  context.database.putInteraction(transaction.id, security.state, transaction.expiresAt);
  const appleUrl = createAppleAuthorizationUrl({ state: security.state });
  await sendFetchResponse(response, htmlResponse(renderAuthorizationPage({
    appleUrl: appleUrl.href,
    csrfToken: security.csrfToken,
    transactionId: transaction.id,
    scopes: transaction.scopes,
    errorMessage,
  }), 200, { "set-cookie": security.setCookie }));
  return true;
}

class OAuthBabyDaybookCommandService implements BabyDaybookCommandService {
  constructor(
    private readonly sessions: OAuthBabyDaybookSessionManager,
    private readonly subject: string,
  ) {}

  async connect(): Promise<BabyDaybookCommandConnection> {
    return { client: await this.sessions.getClient(this.subject), authFile: "encrypted OAuth session" };
  }
}

class OAuthBabyDaybookSessionManager {
  readonly #clients = new Map<string, Promise<BabyDaybookClient>>();

  constructor(
    private readonly database: BabyDaybookOAuthDatabase,
    private readonly fetch: FetchLike,
  ) {}

  getClient(subject: string): Promise<BabyDaybookClient> {
    const existing = this.#clients.get(subject);
    if (existing) return existing;
    const created = this.#createClient(subject).catch((error) => {
      this.#clients.delete(subject);
      throw error;
    });
    this.#clients.set(subject, created);
    return created;
  }

  async #createClient(subject: string): Promise<BabyDaybookClient> {
    const persist = async (session: AuthSessionSnapshot | undefined) => {
      if (session?.refreshToken) this.database.saveBabyDaybookRefreshToken(subject, session.refreshToken);
      else {
        this.database.deleteBabyDaybookSession(subject);
        this.#clients.delete(subject);
      }
    };
    const refreshToken = this.database.loadBabyDaybookRefreshToken(subject);
    return BabyDaybookClient.fromRefreshToken(refreshToken, { fetch: this.fetch, onSessionChanged: persist });
  }
}

class RequestRateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();

  allow(request: IncomingMessage, pathname: string, now = Date.now()): boolean {
    const interaction = pathname.startsWith("/interaction/");
    const limit = interaction ? 10 : AUTHORIZATION_PATHS.has(pathname) ? 120 : undefined;
    if (limit === undefined) return true;
    const windowMs = interaction ? 10 * 60_000 : 60_000;
    const key = `${clientAddress(request)}\0${pathname}`;
    const existing = this.#buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.#buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (this.#buckets.size > 10_000) this.#prune(now);
      return true;
    }
    existing.count += 1;
    return existing.count <= limit;
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) if (bucket.resetAt <= now) this.#buckets.delete(key);
  }
}

function createSigningKey(privateKey: KeyObject): Parameters<typeof createOAuthAuthorizationServer>[0]["signingKey"] {
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("base64url").slice(0, 22);
  return { algorithm: "ES256", keyId, privateKey, publicJwk };
}

function deriveOAuthSubject(firebaseUserId: string, key: Uint8Array): string {
  if (!firebaseUserId) throw new Error("Baby Daybook account did not include a user ID");
  return createHmac("sha256", key).update("baby-daybook-oauth-subject\0").update(firebaseUserId).digest("base64url");
}

function validateAppleCallback(value: string, submittedState: string): URL {
  if (Buffer.byteLength(value, "utf8") > APPLE_CALLBACK_MAX_BYTES) throw new Error("Apple callback is too large");
  let callback: URL;
  try {
    callback = new URL(value.trim());
  } catch {
    throw new Error("Apple callback is invalid");
  }
  const state = callback.searchParams.get("state") ?? "";
  if (callback.protocol !== "intent:" || callback.hostname !== "callback" || !secureEqual(state, submittedState)) {
    throw new Error("Apple callback is invalid");
  }
  if (!callback.searchParams.get("code")?.trim() || !callback.searchParams.get("id_token")?.trim()) {
    throw new Error("Apple callback is incomplete");
  }
  return callback;
}

function validateInteractionRequest(request: IncomingMessage, baseUrl: string, csrfToken: string): void {
  if (!verifyAuthorizationInteractionCsrf({ cookieHeader: request.headers.cookie ?? null, submittedToken: csrfToken })) {
    throw new Error("Authorization form CSRF validation failed");
  }
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const sameOrigin = origin === baseUrl
    || ((!origin || origin === "null")
      && (request.headers["sec-fetch-site"] === "same-origin" || referer?.startsWith(`${baseUrl}/`)));
  if (!sameOrigin) throw new Error("Authorization form origin is invalid");
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new Error("Authorization form encoding is invalid");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > FORM_MAX_BYTES) throw new Error("Authorization form is too large");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function requiredFormValue(form: URLSearchParams, name: string): string {
  const value = form.get(name)?.trim();
  if (!value) throw new Error(`Authorization form is missing ${name}`);
  return value;
}

async function toFetchRequest(request: IncomingMessage, baseUrl: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Buffer.from(await requestToArrayBuffer(request));
  return new Request(new URL(request.url ?? "/", baseUrl), { method, headers, body });
}

async function requestToArrayBuffer(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error("OAuth request is too large");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}

async function sendFetchResponse(response: ServerResponse, fetchResponse: Response): Promise<void> {
  response.statusCode = fetchResponse.status;
  fetchResponse.headers.forEach((value, name) => {
    if (name !== "set-cookie") response.setHeader(name, value);
  });
  const cookies = fetchResponse.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}

function sendJson(response: ServerResponse, status: number, value: unknown, cacheControl = "no-store"): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl });
  response.end(JSON.stringify(value));
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...headers,
    },
  });
}

function renderAuthorizationPage(input: {
  appleUrl: string;
  csrfToken: string;
  transactionId: string;
  scopes: readonly string[];
  errorMessage?: string;
}): string {
  const hidden = `
    <input type="hidden" name="csrf" value="${escapeHtml(input.csrfToken)}">
    <input type="hidden" name="transaction_id" value="${escapeHtml(input.transactionId)}">
    <input type="hidden" name="state" value="${escapeHtml(new URL(input.appleUrl).searchParams.get("state") ?? "")}">`;
  return page("Authorize Baby Daybook", `
    <main>
      <h1>Connect Baby Daybook</h1>
      ${input.errorMessage ? `<p class="error" role="alert">${escapeHtml(input.errorMessage)}</p>` : ""}
      <p>Sign in to your own Baby Daybook account. Credentials are sent only to Baby Daybook and encrypted refresh credentials are stored per OAuth user.</p>
      <p class="scope">Requested access: ${escapeHtml(input.scopes.join(", ") || "Baby Daybook MCP")}</p>
      <section>
        <h2>Sign in with Apple</h2>
        <ol><li><a class="button" href="${escapeHtml(input.appleUrl)}" target="_blank" rel="noreferrer">Open Apple sign-in</a></li><li>After Apple redirects to the app intent, copy the complete <code>intent://callback…</code> value and paste it here.</li></ol>
        <form method="post" action="/interaction/apple">
          ${hidden}
          <label for="callback">Apple callback</label>
          <textarea id="callback" name="callback" required autocomplete="off" spellcheck="false"></textarea>
          <button type="submit">Complete Apple sign-in</button>
        </form>
      </section>
      <section>
        <h2>Email and password</h2>
        <p>Use this only if your Baby Daybook account already has password sign-in enabled.</p>
        <form method="post" action="/interaction/email">
          ${hidden}
          <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username">
          <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
          <button type="submit">Sign in</button>
        </form>
      </section>
    </main>`);
}

function renderCompletionPage(redirectUrl: string): string {
  const escapedUrl = escapeHtml(redirectUrl);
  return page("Baby Daybook connected", `
    <main>
      <h1>Baby Daybook connected</h1>
      <section>
        <p>Authentication succeeded. Returning to the MCP client in two seconds.</p>
        <p>If nothing opens, make sure this browser is running on the same computer as the MCP client, then select the button below.</p>
        <a class="button" href="${escapedUrl}">Return to MCP client</a>
      </section>
    </main>`, `<meta http-equiv="refresh" content="2;url=${escapedUrl}">`);
}

function renderLandingPage(resource: string): string {
  return page("Baby Daybook MCP", `<main><h1>Baby Daybook MCP</h1><p>This public MCP service uses OAuth 2.1 with PKCE. Every user signs in to a separate Baby Daybook account.</p><p>MCP endpoint: <code>${escapeHtml(resource)}</code></p></main>`);
}

function renderErrorPage(): string {
  return page("Authorization failed", "<main><h1>Authorization failed</h1><p>The transaction was invalid, expired, or could not be completed. Restart the MCP connection to begin a fresh authorization.</p></main>");
}

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${extraHead}<title>${escapeHtml(title)}</title><style>
    :root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;background:#f4f1ec;color:#201d19}main{max-width:44rem;margin:3rem auto;padding:0 1.25rem}section{background:#fff;border:1px solid #d8d0c5;border-radius:1rem;padding:1.25rem;margin:1rem 0;box-shadow:0 .4rem 1.5rem #2f24140d}h1,h2{line-height:1.1}h2{font-size:1.15rem}p,li{line-height:1.55}.scope{font-size:.9rem;color:#625a50}.error{padding:.9rem 1rem;border:1px solid #b91c1c;border-radius:.65rem;background:#fee2e2;color:#7f1d1d;font-weight:600}form{display:grid;gap:.65rem;margin-top:1rem}input,textarea,button,.button{font:inherit;border-radius:.6rem}input,textarea{border:1px solid #aaa096;padding:.75rem;background:#fff;color:#201d19}textarea{min-height:8rem;resize:vertical}button,.button{display:inline-block;border:0;padding:.75rem 1rem;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;cursor:pointer}code{overflow-wrap:anywhere}@media(prefers-color-scheme:dark){body{background:#171513;color:#eee8df}section{background:#211e1a;border-color:#494139}.scope{color:#bcb2a6}.error{background:#451a1a;color:#fecaca;border-color:#ef4444}input,textarea{background:#171513;color:#eee8df;border-color:#665d53}}
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("BABY_DAYBOOK_BASE_URL must use HTTPS unless it is loopback");
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("BABY_DAYBOOK_BASE_URL must be an origin URL");
  return url.href.replace(/\/$/u, "");
}

function clientAddress(request: IncomingMessage): string {
  const flyClientIp = request.headers["fly-client-ip"];
  if (typeof flyClientIp === "string" && flyClientIp) return flyClientIp;
  return request.socket.remoteAddress ?? "unknown";
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
