import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";

export async function availablePort() {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function authorize(baseUrl: string, provider: "apple" | "email" = "apple") {
  const redirectUri = "http://127.0.0.1/callback";
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri] }),
  });
  assert.equal(registration.status, 201);
  const { client_id: clientId } = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorization = new URL(`${baseUrl}/authorize`);
  authorization.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    resource: `${baseUrl}/mcp`, scope: "baby-daybook offline_access", state: randomBytes(16).toString("base64url"),
  }).toString();
  const pageResponse = await fetch(authorization);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const hidden = (name: string) => {
    const match = page.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)">`));
    assert.ok(match?.[1], `Missing hidden field ${name}`);
    return match[1];
  };
  const state = hidden("state");
  const completion = await fetch(`${baseUrl}/interaction/${provider}`, {
    method: "POST", redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded", origin: baseUrl,
      cookie: pageResponse.headers.getSetCookie()[0]?.split(";", 1)[0] ?? "",
    },
    body: new URLSearchParams({
      csrf: hidden("csrf"), transaction_id: hidden("transaction_id"), state,
      ...(provider === "email" ? { email: "fixture@example.test", password: "fixture-password" } : {
        callback: `intent://callback?state=${state}&code=fake-apple-code&id_token=fake-apple-id#Intent;package=com.drillyapps.babydaybook;scheme=signinwithapple;end`,
      }),
    }),
  });
  assert.equal(completion.status, 200);
  const html = await completion.text();
  const link = html.match(/<a class="button" href="([^"]+)">Return to MCP client<\/a>/);
  assert.ok(link?.[1]);
  const callback = new URL(link[1].replaceAll("&amp;", "&"));
  const tokenResponse = await fetch(`${baseUrl}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: clientId,
      redirect_uri: redirectUri, code_verifier: verifier, resource: `${baseUrl}/mcp`,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const result = await tokenResponse.json() as { access_token: string };
  const subject = JSON.parse(Buffer.from(result.access_token.split(".")[1]!, "base64url").toString()).sub;
  return { accessToken: result.access_token, subject };
}

export async function mcp(baseUrl: string, accessToken: string, method: string, params: object = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`, "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data:"))?.slice(5);
  assert.ok(data, "Missing MCP response data");
  return JSON.parse(data);
}
