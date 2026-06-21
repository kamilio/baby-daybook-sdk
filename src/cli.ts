import { runCLI } from "toolcraft/cli";
import { runMCP } from "toolcraft/mcp";
import { DefaultBabyDaybookCommandService } from "./command-service.js";
import { babyDaybookCommands } from "./commands.js";
import { parseHTTPOptions, renderHTTPHelp } from "./http-options.js";
import { runBabyDaybookHTTPMCP } from "./toolcraft-http.js";
import { SDK_VERSION } from "./version.js";

if (process.platform !== "win32") process.umask(0o077);

const services = { babyDaybook: new DefaultBabyDaybookCommandService() };
if (process.argv[2] === "http") {
  const parsed = parseHTTPOptions(process.argv.slice(3));
  if (parsed.help) {
    process.stdout.write(renderHTTPHelp());
  } else {
    const handle = await runBabyDaybookHTTPMCP({ ...parsed.options, errorReports: true });
    process.stderr.write(`Baby Daybook HTTP MCP listening at ${handle.url}\n`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void handle.close().then(() => { process.exitCode = 0; }, (error) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode = 1;
        });
      });
    }
  }
} else if (process.argv[2] === "mcp") {
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
