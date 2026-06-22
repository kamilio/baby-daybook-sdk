import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BabyDaybookOAuthDatabase } from "../src/oauth-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("BabyDaybookOAuthDatabase", () => {
  it("persists one-time OAuth records and encrypted per-subject sessions", async () => {
    const { database, filename } = await createDatabase();
    await database.putClient({ id: "client", redirectUris: ["http://127.0.0.1/callback"], createdAt: 1 });
    await database.putAuthorizationTransaction({
      id: "transaction",
      clientId: "client",
      redirectUri: "http://127.0.0.1/callback",
      codeChallenge: "a".repeat(43),
      resource: "https://example.com/mcp",
      scopes: ["baby-daybook"],
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    });
    database.saveBabyDaybookRefreshToken("subject-a", "refresh-a");
    database.saveBabyDaybookRefreshToken("subject-b", "refresh-b");

    await expect(database.getClient("client")).resolves.toMatchObject({ id: "client" });
    await expect(database.takeAuthorizationTransaction("transaction")).resolves.toMatchObject({ id: "transaction" });
    await expect(database.takeAuthorizationTransaction("transaction")).resolves.toBeUndefined();
    expect(database.loadBabyDaybookRefreshToken("subject-a")).toBe("refresh-a");
    expect(database.loadBabyDaybookRefreshToken("subject-b")).toBe("refresh-b");
    expect(() => database.loadBabyDaybookRefreshToken("missing")).toThrow("authorization is missing");
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    database.close();

    const bytes = await readFile(filename);
    expect(bytes.includes(Buffer.from("refresh-a"))).toBe(false);
    expect(bytes.includes(Buffer.from("refresh-b"))).toBe(false);
  });

  it("rotates refresh tokens atomically and revokes a replayed family", async () => {
    const { database } = await createDatabase();
    const token = {
      tokenHash: "old",
      familyId: "family",
      grantId: "grant",
      clientId: "client",
      subject: "subject",
      resource: "https://example.com/mcp",
      scopes: ["baby-daybook", "offline_access"],
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      status: "active" as const,
    };
    await database.putGrant({
      id: "grant",
      clientId: "client",
      subject: "subject",
      resource: "https://example.com/mcp",
      scopes: token.scopes,
      createdAt: 1,
    });
    await database.putRefreshToken(token);

    await expect(database.rotateRefreshToken("old", "new", 10, 100_000)).resolves.toMatchObject({
      status: "rotated",
      previous: { tokenHash: "old", status: "active" },
    });
    await expect(database.rotateRefreshToken("old", "another", 20, 100_000)).resolves.toEqual({ status: "replay" });
    await expect(database.rotateRefreshToken("new", "next", 30, 100_000)).resolves.toEqual({ status: "invalid" });
    await expect(database.getGrant("grant")).resolves.toMatchObject({ revokedAt: 20 });
    database.close();
  });

  it("revokes grants, access tokens, refresh families, and one-time interactions", async () => {
    const { database } = await createDatabase();
    await database.putGrant({ id: "grant", clientId: "client", subject: "subject", resource: "https://example.com/mcp", scopes: [], createdAt: 1 });
    await database.putGrant({ id: "other-grant", clientId: "other-client", subject: "subject", resource: "https://example.com/mcp", scopes: [], createdAt: 1 });
    database.saveBabyDaybookRefreshToken("subject", "baby-refresh");
    await database.putAccessToken({
      tokenHash: "access",
      tokenId: "token-id",
      grantId: "grant",
      subject: "subject",
      clientId: "client",
      resource: "https://example.com/mcp",
      expiresAt: Date.now() + 60_000,
    });
    await database.putRefreshToken({
      tokenHash: "refresh",
      familyId: "family",
      grantId: "grant",
      clientId: "client",
      subject: "subject",
      resource: "https://example.com/mcp",
      scopes: [],
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      status: "active",
    });
    database.putInteraction("transaction", "state", Date.now() + 60_000);

    expect(database.takeInteraction("transaction", "wrong")).toBe(false);
    expect(database.takeInteraction("transaction", "state")).toBe(true);
    expect(database.takeInteraction("transaction", "state")).toBe(false);
    await database.revokeGrant("grant", 50);
    expect(database.loadBabyDaybookRefreshToken("subject")).toBe("baby-refresh");
    await expect(database.getGrant("grant")).resolves.toMatchObject({ revokedAt: 50 });
    await expect(database.getAccessToken("access")).resolves.toMatchObject({ revokedAt: 50 });
    await expect(database.rotateRefreshToken("refresh", "new", 60, 100_000)).resolves.toEqual({ status: "invalid" });
    await database.revokeGrant("other-grant", 70);
    expect(() => database.loadBabyDaybookRefreshToken("subject")).toThrow("authorization is missing");
    database.close();
  });
});

async function createDatabase(): Promise<{ database: BabyDaybookOAuthDatabase; filename: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-daybook-oauth-store-"));
  directories.push(directory);
  const filename = path.join(directory, "oauth.sqlite");
  return { database: new BabyDaybookOAuthDatabase(filename, randomBytes(32)), filename };
}
