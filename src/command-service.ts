import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HandlerEnv } from "toolcraft";
import { BabyDaybookClient } from "./client.js";
import type { AuthSessionSnapshot } from "./types.js";

interface StoredSession {
  schemaVersion?: 1;
  userId?: string;
  email?: string;
  displayName?: string;
  refreshToken: string;
  updatedAt?: string;
}

export interface BabyDaybookCommandConnection {
  client: BabyDaybookClient;
  authFile: string;
}

export interface BabyDaybookCommandService {
  connect(secrets: Record<string, unknown>, env: HandlerEnv): Promise<BabyDaybookCommandConnection>;
}

export interface BabyDaybookCommandServices {
  babyDaybook: BabyDaybookCommandService;
}

export class DefaultBabyDaybookCommandService implements BabyDaybookCommandService {
  async connect(secrets: Record<string, unknown>, env: HandlerEnv): Promise<BabyDaybookCommandConnection> {
    const authFile = path.resolve(env.get("BABY_DAYBOOK_AUTH_FILE") ?? defaultBabyDaybookAuthFile());
    const persist = async (session: AuthSessionSnapshot | undefined) => {
      if (session?.refreshToken) await writeStoredSession(authFile, {
        userId: session.userId,
        email: session.email,
        displayName: session.displayName,
        refreshToken: session.refreshToken,
      });
    };
    const refreshToken = optionalString(secrets.refreshToken);
    const email = optionalString(secrets.email);
    const password = optionalString(secrets.password);
    if ((email && !password) || (!email && password)) {
      throw new Error("BABY_DAYBOOK_EMAIL and BABY_DAYBOOK_PASSWORD must be provided together");
    }
    if (refreshToken) {
      return { client: await BabyDaybookClient.fromRefreshToken(refreshToken, { onSessionChanged: persist }), authFile };
    }
    if (email && password) {
      const client = await BabyDaybookClient.signInWithEmail(email, password, { onSessionChanged: persist });
      await persist(client.session.snapshot);
      return { client, authFile };
    }
    const stored = await readStoredSession(authFile);
    return { client: await BabyDaybookClient.fromRefreshToken(stored.refreshToken, { onSessionChanged: persist }), authFile };
  }
}

export function defaultBabyDaybookAuthFile(): string {
  return path.join(os.homedir(), ".config", "baby-daybook", "auth.json");
}

async function readStoredSession(authFile: string): Promise<StoredSession> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(authFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read Baby Daybook session at ${authFile}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as StoredSession).refreshToken !== "string"
    || !(parsed as StoredSession).refreshToken) {
    throw new Error(`Baby Daybook session at ${authFile} does not contain a refresh token`);
  }
  return { refreshToken: (parsed as StoredSession).refreshToken };
}

async function writeStoredSession(authFile: string, session: StoredSession): Promise<void> {
  const directory = path.dirname(authFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${authFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    refreshToken: session.refreshToken,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, authFile);
  await chmod(authFile, 0o600);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
