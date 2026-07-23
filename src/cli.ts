import { runCLI } from "toolcraft/cli";
import { runMCP } from "toolcraft/mcp";
import { DefaultBabyDaybookCommandService } from "./command-service.js";
import { parseAppleLoginOptions, renderLoginHelp, runAppleLogin } from "./cli-login.js";
import { babyDaybookCommands } from "./commands.js";
import { parseHTTPOptions, renderHTTPHelp } from "./http-options.js";
import { runBabyDaybookHTTPMCP } from "./toolcraft-http.js";
import { SDK_VERSION } from "./version.js";

if (process.platform !== "win32") process.umask(0o077);

const services = { babyDaybook: new DefaultBabyDaybookCommandService() };
if (process.argv[2] === "login") {
  const provider = process.argv[3];
  if (provider === "--help" || provider === "-h" || provider === undefined) {
    process.stdout.write(renderLoginHelp());
  } else if (provider !== "apple") {
    process.stderr.write(`Unknown login provider: ${provider}\n`);
    process.exitCode = 1;
  } else {
    try {
      const parsed = parseAppleLoginOptions(process.argv.slice(4));
      if (parsed.help) process.stdout.write(renderLoginHelp());
      else {
        process.stdout.write("Opening a temporary browser for Baby Daybook Apple login. Complete Apple authentication there.\n");
        const result = await runAppleLogin(parsed.options);
        process.stdout.write("Apple session saved successfully.\n");
        process.stdout.write(`Accessible babies: ${result.babyCount}\n`);
        process.stdout.write(`Persistent refresh-token session: ${result.authFile}\n`);
      }
    } catch (error) {
      process.stderr.write(`Apple login failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
} else if (process.argv[2] === "http") {
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
  if (process.argv[2] === "--help" || process.argv[2] === "-h" || process.argv.length === 2) {
    process.stdout.write("Authentication: baby-daybook login apple [--browser path] [--auth-file path] [--timeout-minutes 30]\n\n");
  }
  await runCLI(babyDaybookCommands, {
    version: SDK_VERSION,
    rootUsageName: "baby-daybook",
    casing: "kebab",
    controls: { output: true, debug: true, verbose: true, yes: true, help: "concise" },
    services,
    errorReports: true,
  });
}
