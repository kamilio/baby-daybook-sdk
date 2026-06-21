import { runCLI } from "toolcraft/cli";
import { runMCP } from "toolcraft/mcp";
import { DefaultBabyDaybookCommandService } from "./command-service.js";
import { babyDaybookCommands } from "./commands.js";
import { SDK_VERSION } from "./version.js";

if (process.platform !== "win32") process.umask(0o077);

const services = { babyDaybook: new DefaultBabyDaybookCommandService() };
if (process.argv[2] === "mcp") {
  await runMCP(babyDaybookCommands, {
    name: "baby-daybook",
    version: SDK_VERSION,
    omitRootToolNamePrefix: true,
    services,
    errorReports: true,
  });
} else {
  await runCLI(babyDaybookCommands, {
    version: SDK_VERSION,
    rootUsageName: "baby-daybook",
    casing: "kebab",
    controls: { output: true, debug: true, verbose: true, yes: true },
    services,
    errorReports: true,
  });
}
