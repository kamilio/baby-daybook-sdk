import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BabyDaybookClient } from "../src/client.js";
import { createBabyDaybookOAuthApp } from "../src/oauth-app.js";
import { authorize, availablePort, mcp } from "./oauth-reconnect-helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Replacement client was blocked by the obsolete request")), 2_000); })]);
  } finally {
    clearTimeout(timer!);
  }
}

async function fixture(expiresIn = "3600") {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const refreshAttempts: string[] = [];
  const failures = new Set<string>();
  let signIns = 0;
  const provider = {
    userId: "same-user",
    refresh: undefined as ((token: string) => Promise<Response> | Response) | undefined,
    response(token: string) {
      return Response.json({ id_token: `firebase-id-${token}`, refresh_token: token, user_id: provider.userId, expires_in: expiresIn });
    },
  };
  const firebaseFetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "identitytoolkit.googleapis.com") {
      signIns += 1;
      return Response.json({ idToken: `login-id-${signIns}`, refreshToken: `refresh-${signIns}`, localId: provider.userId, expiresIn });
    }
    if (url.hostname === "securetoken.googleapis.com") {
      const token = new URLSearchParams(String(init.body)).get("refresh_token")!;
      refreshAttempts.push(token);
      if (failures.has(token)) return Response.json({ error: { message: "TOKEN_EXPIRED" } }, { status: 400 });
      return provider.refresh ? provider.refresh(token) : provider.response(token);
    }
    if (url.hostname === "firestore.googleapis.com") return Response.json({ documents: [] });
    throw new Error(`Unexpected outbound request: ${url.hostname}`);
  };
  const app = await createBabyDaybookOAuthApp({
    baseUrl, databasePath: ":memory:", encryptionKey: randomBytes(32),
    signingPrivateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey, fetch: firebaseFetch,
  });
  await new Promise<void>((resolve) => app.server.listen(port, "127.0.0.1", resolve));
  let toolName: string;
  const connect = async (provider: "apple" | "email" = "apple") => {
    const session = await authorize(baseUrl, provider);
    await mcp(baseUrl, session.accessToken, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "offline-reconnect-test", version: "1" } });
    const listed = await mcp(baseUrl, session.accessToken, "tools/list");
    toolName = listed.result.tools.find((tool: { description?: string }) => tool.description?.includes("List accessible babies")).name;
    return session;
  };
  const list = (accessToken: string) => mcp(baseUrl, accessToken, "tools/call", { name: toolName, arguments: {} });
  return { app, connect, list, provider, refreshAttempts, failures };
}

function expectSuccess(result: Awaited<ReturnType<typeof mcp>>) {
  expect(result.error).toBeUndefined();
  expect(result.result?.isError).not.toBe(true);
  expect(result.result).toBeDefined();
}

describe("OAuth reconnect recovery", () => {
  it.each(["apple", "email"] as const)("uses the replacement session after successful same-user %s reauthorization", async (provider) => {
    const state = await fixture("1");
    try {
      const first = await state.connect(provider);
      expectSuccess(await state.list(first.accessToken));
      state.failures.add("refresh-1");
      const second = await state.connect(provider);
      expect(second.subject).toBe(first.subject);
      expect(state.app.database.loadBabyDaybookRefreshToken(second.subject)).toBe("refresh-2");
      expectSuccess(await state.list(second.accessToken));
      expect(state.refreshAttempts.at(-1)).toBe("refresh-2");
    } finally {
      await state.app.close();
    }
  });

  for (const succeeds of [false, true]) {
    it(`an obsolete pending client ${succeeds ? "cannot overwrite" : "cannot evict"} its replacement`, async () => {
      const state = await fixture();
      const started = deferred();
      const allowed = deferred();
      const requests: Promise<unknown>[] = [];
      try {
        state.provider.refresh = async (token) => {
          if (token !== "refresh-1") return state.provider.response(token);
          started.resolve();
          await allowed.promise;
          return succeeds ? state.provider.response("obsolete-rotated") : Response.json({ error: { message: "Old refresh failed" } }, { status: 400 });
        };
        const first = await state.connect();
        const obsolete = state.list(first.accessToken);
        requests.push(obsolete);
        await withTimeout(started.promise);
        const second = await state.connect();
        const replacement = state.list(second.accessToken);
        requests.push(replacement);
        expectSuccess(await withTimeout(replacement));
        const newRefreshes = state.refreshAttempts.filter((token) => token === "refresh-2").length;
        allowed.resolve();
        await obsolete;
        expect(state.app.database.loadBabyDaybookRefreshToken(second.subject)).toBe("refresh-2");
        expectSuccess(await state.list(second.accessToken));
        expect(state.refreshAttempts.filter((token) => token === "refresh-2")).toHaveLength(newRefreshes);
      } finally {
        allowed.resolve();
        await Promise.allSettled(requests);
        await state.app.close();
      }
    });
  }

  it("drops a cached client after refresh failure so recovery can reload persisted state", async () => {
    const state = await fixture();
    const original = BabyDaybookClient.fromRefreshToken.bind(BabyDaybookClient);
    let cached: BabyDaybookClient | undefined;
    const factory = vi.spyOn(BabyDaybookClient, "fromRefreshToken").mockImplementation(async (...args) => {
      const client = await original(...args);
      cached ??= client;
      return client;
    });
    try {
      const session = await state.connect();
      expectSuccess(await state.list(session.accessToken));
      await cached!.session.updateAuthentication({ expiresAt: 0 });
      state.failures.add("refresh-1");
      expect((await state.list(session.accessToken)).error?.message).toBe("TOKEN_EXPIRED");
      state.app.database.saveBabyDaybookRefreshToken(session.subject, "recovered-refresh");
      expectSuccess(await state.list(session.accessToken));
      expect(state.refreshAttempts.at(-1)).toBe("recovered-refresh");
    } finally {
      factory.mockRestore();
      await state.app.close();
    }
  });

  it("ignores sign-out callbacks from a client superseded by reconnect", async () => {
    const state = await fixture();
    const original = BabyDaybookClient.fromRefreshToken.bind(BabyDaybookClient);
    let obsolete: BabyDaybookClient | undefined;
    const factory = vi.spyOn(BabyDaybookClient, "fromRefreshToken").mockImplementation(async (...args) => {
      const client = await original(...args);
      obsolete ??= client;
      return client;
    });
    try {
      const first = await state.connect();
      expectSuccess(await state.list(first.accessToken));
      const second = await state.connect();
      expectSuccess(await state.list(second.accessToken));
      await obsolete!.session.signOut();
      expect(state.app.database.loadBabyDaybookRefreshToken(second.subject)).toBe("refresh-2");
      expectSuccess(await state.list(second.accessToken));
    } finally {
      factory.mockRestore();
      await state.app.close();
    }
  });

  it("retains persisted state after transient client creation failure", async () => {
    const state = await fixture();
    try {
      const session = await state.connect();
      state.failures.add("refresh-1");
      expect((await state.list(session.accessToken)).error?.message).toBe("TOKEN_EXPIRED");
      expect(state.app.database.loadBabyDaybookRefreshToken(session.subject)).toBe("refresh-1");
      state.failures.clear();
      expectSuccess(await state.list(session.accessToken));
    } finally {
      await state.app.close();
    }
  });

  it("does not discard a different user's cached client", async () => {
    const state = await fixture();
    try {
      const first = await state.connect();
      expectSuccess(await state.list(first.accessToken));
      state.provider.userId = "other-user";
      const second = await state.connect();
      expect(second.subject).not.toBe(first.subject);
      expectSuccess(await state.list(second.accessToken));
      const attempts = state.refreshAttempts.length;
      expectSuccess(await state.list(first.accessToken));
      expect(state.refreshAttempts).toHaveLength(attempts);
    } finally {
      await state.app.close();
    }
  });

  it("still persists changes and sign-out from the current client", async () => {
    const state = await fixture();
    const original = BabyDaybookClient.fromRefreshToken.bind(BabyDaybookClient);
    let current: BabyDaybookClient | undefined;
    const factory = vi.spyOn(BabyDaybookClient, "fromRefreshToken").mockImplementation(async (...args) => {
      current = await original(...args);
      return current;
    });
    try {
      const session = await state.connect();
      expectSuccess(await state.list(session.accessToken));
      await current!.session.updateAuthentication({ refreshToken: "rotated-current" });
      expect(state.app.database.loadBabyDaybookRefreshToken(session.subject)).toBe("rotated-current");
      await current!.session.signOut();
      expect(() => state.app.database.loadBabyDaybookRefreshToken(session.subject)).toThrow("authorization is missing");
      expect((await state.list(session.accessToken)).error?.message).toContain("authorization is missing");
    } finally {
      factory.mockRestore();
      await state.app.close();
    }
  });

  it("shares client creation across concurrent tools and persists its refresh result", async () => {
    const state = await fixture();
    try {
      state.provider.refresh = () => state.provider.response("rotated-initial");
      const session = await state.connect();
      const results = await Promise.all([state.list(session.accessToken), state.list(session.accessToken)]);
      results.forEach(expectSuccess);
      expect(state.refreshAttempts).toEqual(["refresh-1"]);
      expect(state.app.database.loadBabyDaybookRefreshToken(session.subject)).toBe("rotated-initial");
    } finally {
      await state.app.close();
    }
  });
});
