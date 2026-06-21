import { createHTTPMCPServer, runHTTPMCP } from "toolcraft/http";
import type { RunHTTPMCPOptions, ToolcraftHTTPServer, ToolcraftHTTPServerHandle } from "toolcraft/http";
import { DefaultBabyDaybookCommandService } from "./command-service.js";
import type { BabyDaybookCommandServices } from "./command-service.js";
import { babyDaybookCommands } from "./commands.js";
import { SDK_VERSION } from "./version.js";

export type BabyDaybookHTTPMCPOptions = Omit<RunHTTPMCPOptions<BabyDaybookCommandServices>, "name" | "version" | "services"> & {
  name?: string;
  version?: string;
  services?: Partial<BabyDaybookCommandServices>;
};

export function createBabyDaybookHTTPMCPServer(
  options: BabyDaybookHTTPMCPOptions = {},
): Promise<ToolcraftHTTPServer> {
  return createHTTPMCPServer(babyDaybookCommands, resolveOptions(options));
}

export function runBabyDaybookHTTPMCP(
  options: BabyDaybookHTTPMCPOptions = {},
): Promise<ToolcraftHTTPServerHandle> {
  return runHTTPMCP(babyDaybookCommands, resolveOptions(options));
}

function resolveOptions(options: BabyDaybookHTTPMCPOptions): RunHTTPMCPOptions<BabyDaybookCommandServices> {
  return {
    ...options,
    name: options.name ?? "baby-daybook",
    version: options.version ?? SDK_VERSION,
    omitRootToolNamePrefix: true,
    services: {
      babyDaybook: options.services?.babyDaybook ?? new DefaultBabyDaybookCommandService(),
    },
  };
}
