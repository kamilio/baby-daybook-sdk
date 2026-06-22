import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBabyDaybookOAuthApp, decodeSessionEncryptionKey, importOAuthSigningPrivateKey } from "../src/oauth-app.js";
import type { FetchLike } from "../src/types.js";
import { jsonResponse } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
});

describe("Baby Daybook OAuth app", () => {
  it("completes Apple OAuth with PKCE, isolated subjects, encrypted credentials, and refresh rotation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "baby-daybook-oauth-app-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const databasePath = path.join(directory, "oauth.sqlite");
    const encryptionKey = randomBytes(32);
    let identity = 0;
    const firebaseFetch = vi.fn(async () => {
      identity += 1;
      return jsonResponse({
        idToken: `firebase-id-${identity}`,
        refreshToken: `firebase-refresh-${identity}`,
        localId: `firebase-user-${identity}`,
        expiresIn: "3600",
      });
    }) as FetchLike;
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const app = await createBabyDaybookOAuthApp({ baseUrl, databasePath, encryptionKey, signingPrivateKey: privateKey, fetch: firebaseFetch });
    app.server.listen(port, "127.0.0.1");
    await new Promise<void>((resolve) => app.server.once("listening", resolve));
    cleanups.push(() => app.close());

    const metadata = await readJson<Record<string, unknown>>(await fetch(`${baseUrl}/.well-known/oauth-authorization-server`));
    expect(metadata).toMatchObject({ issuer: baseUrl, authorization_endpoint: `${baseUrl}/authorize`, token_endpoint: `${baseUrl}/token` });
    const protectedMetadata = await readJson<Record<string, unknown>>(await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`));
    expect(protectedMetadata).toMatchObject({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl] });
    const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);

    const first = await authorizeApple(baseUrl, "firebase-user-1");
    const second = await authorizeApple(baseUrl, "firebase-user-2");
    expect(first.token.sub).not.toBe(second.token.sub);
    expect(first.token.aud).toBe(`${baseUrl}/mcp`);
    expect(first.response.scope).toContain("baby-daybook");
    expect(first.response.refresh_token).toBeTypeOf("string");
    expect(firebaseFetch).toHaveBeenCalledTimes(2);

    const refreshed = await tokenRequest(baseUrl, {
      grant_type: "refresh_token",
      refresh_token: first.response.refresh_token,
      client_id: first.clientId,
      resource: `${baseUrl}/mcp`,
    });
    expect(refreshed.status).toBe(200);
    const refreshedBody = await refreshed.json() as TokenResponse;
    expect(refreshedBody.refresh_token).not.toBe(first.response.refresh_token);
    const replay = await tokenRequest(baseUrl, {
      grant_type: "refresh_token",
      refresh_token: first.response.refresh_token,
      client_id: first.clientId,
      resource: `${baseUrl}/mcp`,
    });
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({ error: "invalid_grant" });
    const revokedFamily = await tokenRequest(baseUrl, {
      grant_type: "refresh_token",
      refresh_token: refreshedBody.refresh_token,
      client_id: first.clientId,
      resource: `${baseUrl}/mcp`,
    });
    expect(revokedFamily.status).toBe(400);

    const databaseBytes = Buffer.concat(await Promise.all(
      [databasePath, `${databasePath}-wal`].map(async (filename) => readFile(filename).catch(() => Buffer.alloc(0))),
    ));
    for (const secret of ["firebase-refresh-1", "firebase-refresh-2", "firebase-user-1", "firebase-user-2"]) {
      expect(databaseBytes.includes(Buffer.from(secret))).toBe(false);
    }
  });

  it("validates production key configuration", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const encoded = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(importOAuthSigningPrivateKey(encoded).asymmetricKeyType).toBe("ec");
    expect(() => importOAuthSigningPrivateKey("invalid")).toThrow("base64 PKCS#8");
    expect(decodeSessionEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => decodeSessionEncryptionKey("short")).toThrow("32 bytes");
  });
});

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  scope: string;
}

async function authorizeApple(baseUrl: string, expectedFirebaseUser: string): Promise<{
  clientId: string;
  response: TokenResponse;
  token: Record<string, unknown>;
}> {
  const redirectUri = "http://127.0.0.1/callback";
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri] }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await readJson<{ client_id: string }>(registration);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${baseUrl}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${baseUrl}/mcp`,
    scope: "baby-daybook offline_access",
    state: randomBytes(16).toString("base64url"),
  }).toString();
  const pageResponse = await fetch(authorize);
  expect(pageResponse.status).toBe(200);
  const page = await pageResponse.text();
  const cookie = pageResponse.headers.getSetCookie()[0]?.split(";", 1)[0];
  const csrf = hiddenValue(page, "csrf");
  const transactionId = hiddenValue(page, "transaction_id");
  const appleState = hiddenValue(page, "state");
  const callback = `intent://callback?state=${encodeURIComponent(appleState)}&code=apple-code&id_token=apple-id#Intent;package=com.drillyapps.babydaybook;scheme=signinwithapple;end`;
  const completion = await fetch(`${baseUrl}/interaction/apple`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookie ?? "",
      origin: baseUrl,
    },
    body: new URLSearchParams({ csrf, transaction_id: transactionId, state: appleState, callback }),
  });
  expect(completion.status).toBe(303);
  const callbackUrl = new URL(completion.headers.get("location") ?? "");
  const code = callbackUrl.searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenResponse = await tokenRequest(baseUrl, {
    grant_type: "authorization_code",
    code: code ?? "",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: `${baseUrl}/mcp`,
  });
  expect(tokenResponse.status).toBe(200);
  const response = await readJson<TokenResponse>(tokenResponse);
  const token = JSON.parse(Buffer.from(response.access_token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  expect(token.sub).not.toBe(expectedFirebaseUser);
  return { clientId, response, token };
}

function tokenRequest(baseUrl: string, values: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

function hiddenValue(page: string, name: string): string {
  const match = page.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)">`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return match[1];
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new Error(`Empty JSON response from ${response.url} (${response.status})`);
  return JSON.parse(text) as T;
}
