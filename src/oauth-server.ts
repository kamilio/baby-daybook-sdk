#!/usr/bin/env node
import { once } from "node:events";
import { createBabyDaybookOAuthApp, decodeSessionEncryptionKey, importOAuthSigningPrivateKey } from "./oauth-app.js";

process.umask(0o077);
const baseUrl = requiredEnvironment("BABY_DAYBOOK_BASE_URL");
const databasePath = process.env.BABY_DAYBOOK_DB_PATH ?? "/data/baby-daybook.sqlite";
const port = parsePort(process.env.PORT ?? "8080");
const app = await createBabyDaybookOAuthApp({
  baseUrl,
  databasePath,
  encryptionKey: decodeSessionEncryptionKey(requiredEnvironment("BABY_DAYBOOK_SESSION_ENCRYPTION_KEY")),
  signingPrivateKey: importOAuthSigningPrivateKey(requiredEnvironment("BABY_DAYBOOK_OAUTH_SIGNING_KEY")),
});

app.server.listen(port, "::");
await once(app.server, "listening");
process.stdout.write(`Baby Daybook OAuth MCP listening on ${baseUrl}/mcp\n`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    app.close().then(() => process.exit(0), (error) => {
      console.error("Baby Daybook OAuth MCP shutdown failed", error);
      process.exit(1);
    });
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be from 1 to 65535");
  return port;
}
