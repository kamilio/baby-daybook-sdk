import { describe, expect, it } from "vitest";
import { parseHTTPOptions, renderHTTPHelp } from "../src/http-options.js";

describe("HTTP MCP options", () => {
  it("uses secure upstream defaults when no flags are provided", () => {
    expect(parseHTTPOptions([])).toEqual({ help: false, options: {} });
  });

  it("parses supported transport and security controls", () => {
    const parsed = parseHTTPOptions([
      "--hostname", "127.0.0.1",
      "--port", "8080",
      "--path", "/api/mcp",
      "--stateless",
      "--json-response",
      "--allowed-host", "localhost:8080",
      "--allowed-host", "127.0.0.1:8080",
      "--allowed-origin", "https://app.example.com",
      "--trusted-proxy",
      "--max-request-bytes", "1048576",
      "--max-batch-size", "16",
      "--max-sessions", "1000",
      "--session-ttl-ms", "900000",
      "--max-streams-per-session", "2",
      "--max-concurrent-tool-calls", "32",
      "--request-timeout-ms", "30000",
    ]);
    expect(parsed.help).toBe(false);
    expect(parsed.options).toMatchObject({
      hostname: "127.0.0.1",
      port: 8080,
      path: "/api/mcp",
      enableJsonResponse: true,
      allowedHosts: ["localhost:8080", "127.0.0.1:8080"],
      allowedOrigins: ["https://app.example.com"],
      trustedProxy: true,
      maxRequestBytes: 1_048_576,
      maxBatchSize: 16,
      maxSessions: 1_000,
      sessionTtlMs: 900_000,
      maxStreamsPerSession: 2,
      maxConcurrentToolCalls: 32,
      requestTimeoutMs: 30_000,
    });
    expect(Object.hasOwn(parsed.options, "sessionIdGenerator")).toBe(true);
    expect(parsed.options.sessionIdGenerator).toBeUndefined();
  });

  it("rejects unknown, missing, unsafe, and out-of-range values", () => {
    expect(() => parseHTTPOptions(["--unknown"])).toThrow("Unknown HTTP MCP option");
    expect(() => parseHTTPOptions(["--port"])).toThrow("requires a value");
    expect(() => parseHTTPOptions(["--path", "mcp"])).toThrow("must begin with /");
    expect(() => parseHTTPOptions(["--port", "65536"])).toThrow("must be an integer");
    expect(() => parseHTTPOptions(["--session-ttl-ms", "999"])).toThrow("must be an integer");
    expect(() => parseHTTPOptions(["--stateful", "--stateless"])).toThrow("cannot be used together");
  });

  it("renders standalone help", () => {
    expect(parseHTTPOptions(["--help"]).help).toBe(true);
    expect(typeof parseHTTPOptions(["--stateful"]).options.sessionIdGenerator).toBe("function");
    expect(renderHTTPHelp()).toContain("--allowed-origin");
  });
});
