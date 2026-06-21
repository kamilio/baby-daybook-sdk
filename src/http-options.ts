import { randomUUID } from "node:crypto";
import type { BabyDaybookHTTPMCPOptions } from "./toolcraft-http.js";

export interface ParsedHTTPOptions {
  help: boolean;
  options: BabyDaybookHTTPMCPOptions;
}

const integerFlags = new Map<string, { key: keyof BabyDaybookHTTPMCPOptions; minimum: number; maximum: number }>([
  ["--port", { key: "port", minimum: 0, maximum: 65_535 }],
  ["--max-request-bytes", { key: "maxRequestBytes", minimum: 1, maximum: 64 * 1024 * 1024 }],
  ["--max-batch-size", { key: "maxBatchSize", minimum: 1, maximum: 1_000 }],
  ["--max-sessions", { key: "maxSessions", minimum: 1, maximum: 100_000 }],
  ["--session-ttl-ms", { key: "sessionTtlMs", minimum: 1_000, maximum: 24 * 60 * 60_000 }],
  ["--max-streams-per-session", { key: "maxStreamsPerSession", minimum: 1, maximum: 100 }],
  ["--max-concurrent-tool-calls", { key: "maxConcurrentToolCalls", minimum: 1, maximum: 10_000 }],
  ["--request-timeout-ms", { key: "requestTimeoutMs", minimum: 1_000, maximum: 10 * 60_000 }],
]);

export function parseHTTPOptions(argv: string[]): ParsedHTTPOptions {
  const options: Record<string, unknown> = {};
  const allowedHosts: string[] = [];
  const allowedOrigins: string[] = [];
  let sessionMode: "stateful" | "stateless" | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) throw new Error("HTTP MCP arguments are malformed");
    if (argument === "--help" || argument === "-h") return { help: true, options: {} };
    if (argument === "--stateless") {
      if (sessionMode === "stateful") throw new Error("--stateful and --stateless cannot be used together");
      sessionMode = "stateless";
      options.sessionIdGenerator = undefined;
      continue;
    }
    if (argument === "--stateful") {
      if (sessionMode === "stateless") throw new Error("--stateful and --stateless cannot be used together");
      sessionMode = "stateful";
      options.sessionIdGenerator = randomUUID;
      continue;
    }
    if (argument === "--json-response") {
      options.enableJsonResponse = true;
      continue;
    }
    if (argument === "--trusted-proxy") {
      options.trustedProxy = true;
      continue;
    }
    if (argument === "--hostname" || argument === "--path" || argument === "--allowed-host" || argument === "--allowed-origin") {
      const value = requiredValue(argv, ++index, argument);
      if (argument === "--hostname") options.hostname = value;
      else if (argument === "--path") {
        if (!value.startsWith("/")) throw new Error("--path must begin with /");
        options.path = value;
      } else if (argument === "--allowed-host") allowedHosts.push(value);
      else allowedOrigins.push(value);
      continue;
    }
    const integer = integerFlags.get(argument);
    if (integer) {
      const value = Number(requiredValue(argv, ++index, argument));
      if (!Number.isSafeInteger(value) || value < integer.minimum || value > integer.maximum) {
        throw new Error(`${argument} must be an integer from ${integer.minimum} to ${integer.maximum}`);
      }
      options[integer.key] = value;
      continue;
    }
    throw new Error(`Unknown HTTP MCP option: ${argument}`);
  }
  if (allowedHosts.length > 0) options.allowedHosts = allowedHosts;
  if (allowedOrigins.length > 0) options.allowedOrigins = allowedOrigins;
  return { help: false, options: options as BabyDaybookHTTPMCPOptions };
}

export function renderHTTPHelp(): string {
  return `baby-daybook http — Run the Toolcraft MCP server over Streamable HTTP

Usage: baby-daybook http [OPTIONS]

Options:
  --hostname <host>                 Bind host (default: 127.0.0.1)
  --port <port>                     Bind port; 0 selects a free port (default: 0)
  --path <path>                     MCP endpoint path (default: /mcp)
  --stateful                        Enable persistent sessions with random UUIDs
  --stateless                       Disable persistent MCP sessions
  --json-response                   Return JSON instead of SSE where supported
  --allowed-host <host>             Allow a Host value; repeatable
  --allowed-origin <origin>         Allow an Origin value; repeatable
  --trusted-proxy                   Trust forwarded proxy headers
  --max-request-bytes <bytes>       Maximum request body size
  --max-batch-size <count>          Maximum JSON-RPC batch size
  --max-sessions <count>            Maximum active sessions
  --session-ttl-ms <ms>             Session expiry interval
  --max-streams-per-session <count> Maximum concurrent SSE streams per session
  --max-concurrent-tool-calls <n>   Maximum concurrent tool invocations
  --request-timeout-ms <ms>         HTTP request timeout
  -h, --help                        Show this help
`;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}
