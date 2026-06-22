import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import type * as NodeSQLite from "node:sqlite";
import type { DatabaseSync as SQLiteDatabaseSync } from "node:sqlite";
import type { AuthorizationServerStore } from "toolcraft/http";

const { DatabaseSync } = createRequire(import.meta.url)(["node", "sqlite"].join(":")) as typeof NodeSQLite;

type OAuthClientRecord = Parameters<AuthorizationServerStore["putClient"]>[0];
type AuthorizationTransactionRecord = Parameters<AuthorizationServerStore["putAuthorizationTransaction"]>[0];
type AuthorizationCodeRecord = Parameters<AuthorizationServerStore["putAuthorizationCode"]>[0];
type AuthorizationGrantRecord = Parameters<AuthorizationServerStore["putGrant"]>[0];
type AccessTokenRecord = Parameters<AuthorizationServerStore["putAccessToken"]>[0];
type RefreshTokenRecord = Parameters<AuthorizationServerStore["putRefreshToken"]>[0];
type RefreshTokenRotationResult = Awaited<ReturnType<AuthorizationServerStore["rotateRefreshToken"]>>;

interface JsonRow {
  json: string;
}

interface InteractionRow {
  state: string;
  expires_at: number;
}

interface SessionRow {
  encrypted_refresh_token: string;
}

const RECORD_CLIENT = "client";
const RECORD_TRANSACTION = "transaction";
const RECORD_CODE = "code";
const RECORD_GRANT = "grant";

export class BabyDaybookOAuthDatabase implements AuthorizationServerStore {
  readonly #database: SQLiteDatabaseSync;
  readonly #encryptionKey: Buffer;

  constructor(filename: string, encryptionKey: Uint8Array) {
    if (encryptionKey.byteLength !== 32) throw new Error("Baby Daybook session encryption key must be 32 bytes");
    this.#encryptionKey = Buffer.from(encryptionKey);
    this.#database = new DatabaseSync(filename);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      try {
        chmodSync(path, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS oauth_records (
        kind TEXT NOT NULL,
        record_key TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (kind, record_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        token_hash TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS oauth_access_tokens_grant_id ON oauth_access_tokens (grant_id);
      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
        expires_at INTEGER NOT NULL,
        json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_id ON oauth_refresh_tokens (family_id);
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_grant_id ON oauth_refresh_tokens (grant_id);
      CREATE TABLE IF NOT EXISTS authorization_interactions (
        transaction_id TEXT PRIMARY KEY,
        state TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS baby_daybook_sessions (
        subject TEXT PRIMARY KEY,
        encrypted_refresh_token TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
    `);
  }

  close(): void {
    this.#database.close();
  }

  async putClient(client: OAuthClientRecord): Promise<void> {
    this.#putRecord(RECORD_CLIENT, client.id, client);
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | undefined> {
    return this.#getRecord<OAuthClientRecord>(RECORD_CLIENT, clientId);
  }

  async putAuthorizationTransaction(transaction: AuthorizationTransactionRecord): Promise<void> {
    this.#putRecord(RECORD_TRANSACTION, transaction.id, transaction);
  }

  async takeAuthorizationTransaction(transactionId: string): Promise<AuthorizationTransactionRecord | undefined> {
    return this.#takeRecord<AuthorizationTransactionRecord>(RECORD_TRANSACTION, transactionId);
  }

  async putAuthorizationCode(code: AuthorizationCodeRecord): Promise<void> {
    this.#putRecord(RECORD_CODE, code.tokenHash, code);
  }

  async takeAuthorizationCode(tokenHash: string): Promise<AuthorizationCodeRecord | undefined> {
    return this.#takeRecord<AuthorizationCodeRecord>(RECORD_CODE, tokenHash);
  }

  async putGrant(grant: AuthorizationGrantRecord): Promise<void> {
    this.#putRecord(RECORD_GRANT, grant.id, grant);
  }

  async getGrant(grantId: string): Promise<AuthorizationGrantRecord | undefined> {
    return this.#getRecord<AuthorizationGrantRecord>(RECORD_GRANT, grantId);
  }

  async putAccessToken(token: AccessTokenRecord): Promise<void> {
    this.#database.prepare(`
      INSERT INTO oauth_access_tokens (token_hash, grant_id, expires_at, revoked_at, json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        grant_id = excluded.grant_id,
        expires_at = excluded.expires_at,
        revoked_at = excluded.revoked_at,
        json = excluded.json
    `).run(token.tokenHash, token.grantId, token.expiresAt, token.revokedAt ?? null, JSON.stringify(token));
  }

  async getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined> {
    const row = this.#database.prepare("SELECT json FROM oauth_access_tokens WHERE token_hash = ?").get(tokenHash) as JsonRow | undefined;
    return row ? JSON.parse(row.json) as AccessTokenRecord : undefined;
  }

  async putRefreshToken(token: RefreshTokenRecord): Promise<void> {
    this.#putRefreshToken(token);
  }

  async rotateRefreshToken(
    tokenHash: string,
    replacementTokenHash: string,
    now: number,
    expiresAt: number,
  ): Promise<RefreshTokenRotationResult> {
    return this.#transaction(() => {
      const row = this.#database.prepare("SELECT json FROM oauth_refresh_tokens WHERE token_hash = ?").get(tokenHash) as JsonRow | undefined;
      if (!row) return { status: "invalid" };
      const token = JSON.parse(row.json) as RefreshTokenRecord;
      if (token.expiresAt <= now || token.status === "revoked") return { status: "invalid" };
      if (token.status === "rotated") {
        this.#revokeFamily(token.familyId, now);
        return { status: "replay" };
      }
      this.#putRefreshToken({ ...token, status: "rotated" });
      this.#putRefreshToken({
        ...token,
        tokenHash: replacementTokenHash,
        createdAt: now,
        expiresAt,
        status: "active",
      });
      return { status: "rotated", previous: token };
    });
  }

  async revokeToken(tokenHash: string, now: number): Promise<void> {
    this.#transaction(() => {
      const refreshRow = this.#database.prepare("SELECT json FROM oauth_refresh_tokens WHERE token_hash = ?").get(tokenHash) as JsonRow | undefined;
      if (refreshRow) this.#revokeFamily((JSON.parse(refreshRow.json) as RefreshTokenRecord).familyId, now);
      const accessRow = this.#database.prepare("SELECT json FROM oauth_access_tokens WHERE token_hash = ?").get(tokenHash) as JsonRow | undefined;
      if (accessRow) this.#putAccessTokenSync({ ...JSON.parse(accessRow.json) as AccessTokenRecord, revokedAt: now });
    });
  }

  async revokeGrant(grantId: string, now: number): Promise<void> {
    this.#transaction(() => {
      const grant = this.#getRecord<AuthorizationGrantRecord>(RECORD_GRANT, grantId);
      if (grant) this.#putRecord(RECORD_GRANT, grantId, { ...grant, revokedAt: now });
      const refreshRows = this.#database.prepare("SELECT json FROM oauth_refresh_tokens WHERE grant_id = ?").all(grantId) as unknown as JsonRow[];
      for (const row of refreshRows) this.#putRefreshToken({ ...JSON.parse(row.json) as RefreshTokenRecord, status: "revoked" });
      const accessRows = this.#database.prepare("SELECT json FROM oauth_access_tokens WHERE grant_id = ?").all(grantId) as unknown as JsonRow[];
      for (const row of accessRows) this.#putAccessTokenSync({ ...JSON.parse(row.json) as AccessTokenRecord, revokedAt: now });
      if (grant) this.#deleteSessionWithoutActiveGrant(grant.subject);
    });
  }

  putInteraction(transactionId: string, state: string, expiresAt: number): void {
    this.#database.prepare(`
      INSERT INTO authorization_interactions (transaction_id, state, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at
    `).run(transactionId, state, expiresAt);
  }

  takeInteraction(transactionId: string, state: string, now = Date.now()): boolean {
    return this.#transaction(() => {
      const row = this.#database.prepare(
        "SELECT state, expires_at FROM authorization_interactions WHERE transaction_id = ?",
      ).get(transactionId) as InteractionRow | undefined;
      if (!row || row.expires_at <= now || !secureEqual(row.state, state)) return false;
      this.#database.prepare("DELETE FROM authorization_interactions WHERE transaction_id = ?").run(transactionId);
      return true;
    });
  }

  saveBabyDaybookRefreshToken(subject: string, refreshToken: string): void {
    const encrypted = encryptRefreshToken(refreshToken, subject, this.#encryptionKey);
    this.#database.prepare(`
      INSERT INTO baby_daybook_sessions (subject, encrypted_refresh_token, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(subject) DO UPDATE SET
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        updated_at = excluded.updated_at
    `).run(subject, encrypted, Date.now());
  }

  loadBabyDaybookRefreshToken(subject: string): string {
    const row = this.#database.prepare(
      "SELECT encrypted_refresh_token FROM baby_daybook_sessions WHERE subject = ?",
    ).get(subject) as SessionRow | undefined;
    if (!row) throw new Error("Baby Daybook authorization is missing for this OAuth subject");
    return decryptRefreshToken(row.encrypted_refresh_token, subject, this.#encryptionKey);
  }

  deleteBabyDaybookSession(subject: string): void {
    this.#database.prepare("DELETE FROM baby_daybook_sessions WHERE subject = ?").run(subject);
  }

  pruneExpired(now = Date.now()): void {
    this.#database.prepare("DELETE FROM authorization_interactions WHERE expires_at <= ?").run(now);
    this.#database.prepare("DELETE FROM oauth_access_tokens WHERE expires_at <= ?").run(now);
    this.#database.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at <= ?").run(now);
    const transactions = this.#database.prepare(
      "SELECT record_key, json FROM oauth_records WHERE kind = ?",
    ).all(RECORD_TRANSACTION) as unknown as Array<JsonRow & { record_key: string }>;
    const codes = this.#database.prepare(
      "SELECT record_key, json FROM oauth_records WHERE kind = ?",
    ).all(RECORD_CODE) as unknown as Array<JsonRow & { record_key: string }>;
    for (const row of [...transactions, ...codes]) {
      const value = JSON.parse(row.json) as { expiresAt?: number };
      if (value.expiresAt !== undefined && value.expiresAt <= now) {
        const kind = transactions.includes(row) ? RECORD_TRANSACTION : RECORD_CODE;
        this.#database.prepare("DELETE FROM oauth_records WHERE kind = ? AND record_key = ?").run(kind, row.record_key);
      }
    }
  }

  #putRecord(kind: string, key: string, value: unknown): void {
    this.#database.prepare(`
      INSERT INTO oauth_records (kind, record_key, json) VALUES (?, ?, ?)
      ON CONFLICT(kind, record_key) DO UPDATE SET json = excluded.json
    `).run(kind, key, JSON.stringify(value));
  }

  #getRecord<T>(kind: string, key: string): T | undefined {
    const row = this.#database.prepare("SELECT json FROM oauth_records WHERE kind = ? AND record_key = ?").get(kind, key) as JsonRow | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }

  #takeRecord<T>(kind: string, key: string): T | undefined {
    return this.#transaction(() => {
      const value = this.#getRecord<T>(kind, key);
      this.#database.prepare("DELETE FROM oauth_records WHERE kind = ? AND record_key = ?").run(kind, key);
      return value;
    });
  }

  #putRefreshToken(token: RefreshTokenRecord): void {
    this.#database.prepare(`
      INSERT INTO oauth_refresh_tokens (token_hash, family_id, grant_id, status, expires_at, json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        family_id = excluded.family_id,
        grant_id = excluded.grant_id,
        status = excluded.status,
        expires_at = excluded.expires_at,
        json = excluded.json
    `).run(token.tokenHash, token.familyId, token.grantId, token.status, token.expiresAt, JSON.stringify(token));
  }

  #putAccessTokenSync(token: AccessTokenRecord): void {
    this.#database.prepare(`
      INSERT INTO oauth_access_tokens (token_hash, grant_id, expires_at, revoked_at, json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        grant_id = excluded.grant_id,
        expires_at = excluded.expires_at,
        revoked_at = excluded.revoked_at,
        json = excluded.json
    `).run(token.tokenHash, token.grantId, token.expiresAt, token.revokedAt ?? null, JSON.stringify(token));
  }

  #revokeFamily(familyId: string, now: number): void {
    const rows = this.#database.prepare("SELECT json FROM oauth_refresh_tokens WHERE family_id = ?").all(familyId) as unknown as JsonRow[];
    const grantIds = new Set<string>();
    for (const row of rows) {
      const token = JSON.parse(row.json) as RefreshTokenRecord;
      grantIds.add(token.grantId);
      this.#putRefreshToken({ ...token, status: "revoked" });
    }
    for (const grantId of grantIds) {
      const grant = this.#getRecord<AuthorizationGrantRecord>(RECORD_GRANT, grantId);
      if (grant && grant.revokedAt === undefined) {
        this.#putRecord(RECORD_GRANT, grantId, { ...grant, revokedAt: now });
        this.#deleteSessionWithoutActiveGrant(grant.subject);
      }
    }
  }

  #deleteSessionWithoutActiveGrant(subject: string): void {
    const rows = this.#database.prepare("SELECT json FROM oauth_records WHERE kind = ?").all(RECORD_GRANT) as unknown as JsonRow[];
    const hasActiveGrant = rows.some((row) => {
      const grant = JSON.parse(row.json) as AuthorizationGrantRecord;
      return grant.subject === subject && grant.revokedAt === undefined;
    });
    if (!hasActiveGrant) this.deleteBabyDaybookSession(subject);
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

function encryptRefreshToken(refreshToken: string, subject: string, key: Buffer): string {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(subject));
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return ["v1", Buffer.from(iv).toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptRefreshToken(value: string, subject: string, key: Buffer): string {
  const [version, iv, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra !== undefined) throw new Error("Stored Baby Daybook session is invalid");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(subject));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new Error("Stored Baby Daybook session could not be decrypted", { cause: error });
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
