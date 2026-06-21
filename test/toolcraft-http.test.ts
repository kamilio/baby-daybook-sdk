import { describe, expect, it, vi } from "vitest";
import type { BabyDaybookCommandService } from "../src/command-service.js";
import { createBabyDaybookHTTPMCPServer, runBabyDaybookHTTPMCP } from "../src/toolcraft-http.js";

const service = { connect: vi.fn() } as unknown as BabyDaybookCommandService;

describe("Baby Daybook HTTP MCP", () => {
  it("creates an unbound server with injected services", async () => {
    const server = await createBabyDaybookHTTPMCPServer({ services: { babyDaybook: service } });
    expect(typeof server.listenHttp).toBe("function");
  });

  it("binds to a free loopback port and closes cleanly", async () => {
    const handle = await runBabyDaybookHTTPMCP({
      hostname: "127.0.0.1",
      port: 0,
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
      services: { babyDaybook: service },
    });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
