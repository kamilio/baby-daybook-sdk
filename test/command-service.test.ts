import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BabyDaybookClient } from "../src/client.js";
import { DefaultBabyDaybookCommandService } from "../src/command-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DefaultBabyDaybookCommandService", () => {
  it("loads and securely rotates a persisted refresh-token session", async () => {
    const directory = await temporaryDirectory();
    const authFile = path.join(directory, "nested", "auth.json");
    await mkdir(path.dirname(authFile), { recursive: true });
    await writeFile(authFile, '{"refreshToken":"old"}\n');
    let onSessionChanged: ((session: any) => Promise<void>) | undefined;
    const client = { session: { snapshot: { refreshToken: "old" } } } as BabyDaybookClient;
    const fromRefreshToken = vi.spyOn(BabyDaybookClient, "fromRefreshToken").mockImplementation(async (refreshToken, options) => {
      expect(refreshToken).toBe("old");
      onSessionChanged = options?.onSessionChanged as typeof onSessionChanged;
      return client;
    });

    const connection = await new DefaultBabyDaybookCommandService().connect({}, env({ BABY_DAYBOOK_AUTH_FILE: authFile }));
    expect(connection).toEqual({ client, authFile });
    expect(fromRefreshToken).toHaveBeenCalledOnce();
    await onSessionChanged?.({ refreshToken: "rotated" });
    expect(JSON.parse(await readFile(authFile, "utf8"))).toMatchObject({ schemaVersion: 1, refreshToken: "rotated" });
    expect((await stat(authFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(authFile))).mode & 0o777).toBe(0o700);
  });

  it("uses explicit refresh-token credentials before the auth file", async () => {
    const client = {} as BabyDaybookClient;
    const fromRefreshToken = vi.spyOn(BabyDaybookClient, "fromRefreshToken").mockResolvedValue(client);
    await expect(new DefaultBabyDaybookCommandService().connect({ refreshToken: "explicit" }, env({})))
      .resolves.toMatchObject({ client });
    expect(fromRefreshToken).toHaveBeenCalledWith("explicit", expect.any(Object));
  });

  it("signs in with paired email credentials and rejects incomplete pairs", async () => {
    const directory = await temporaryDirectory();
    const authFile = path.join(directory, "auth.json");
    const client = { session: { snapshot: { refreshToken: "signed-in" } } } as BabyDaybookClient;
    const signIn = vi.spyOn(BabyDaybookClient, "signInWithEmail").mockResolvedValue(client);
    const service = new DefaultBabyDaybookCommandService();
    await expect(service.connect({ email: "parent@example.com", password: "password" }, env({ BABY_DAYBOOK_AUTH_FILE: authFile })))
      .resolves.toMatchObject({ client, authFile });
    expect(signIn).toHaveBeenCalledWith("parent@example.com", "password", expect.any(Object));
    expect(JSON.parse(await readFile(authFile, "utf8"))).toMatchObject({ schemaVersion: 1, refreshToken: "signed-in" });
    await expect(service.connect({ email: "parent@example.com" }, env({ BABY_DAYBOOK_AUTH_FILE: authFile })))
      .rejects.toThrow("must be provided together");
  });

  it("rejects missing or malformed persisted sessions", async () => {
    const directory = await temporaryDirectory();
    const authFile = path.join(directory, "auth.json");
    const service = new DefaultBabyDaybookCommandService();
    await expect(service.connect({}, env({ BABY_DAYBOOK_AUTH_FILE: authFile }))).rejects.toThrow("Unable to read");
    await writeFile(authFile, "{}\n");
    await expect(service.connect({}, env({ BABY_DAYBOOK_AUTH_FILE: authFile }))).rejects.toThrow("does not contain a refresh token");
  });
});

function env(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-daybook-command-service-"));
  temporaryDirectories.push(directory);
  return directory;
}
