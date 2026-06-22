import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_BROWSER_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

interface ChromeTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface CaptureAppleCallbackOptions {
  authorizationUrl: string;
  redirectUri: string;
  browserPath?: string;
  timeoutMillis?: number;
}

export function resolveBrowserExecutable(
  explicitPath?: string,
  candidates: readonly string[] = DEFAULT_BROWSER_CANDIDATES,
): string {
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new Error(`Browser executable does not exist: ${explicitPath}`);
    return explicitPath;
  }
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error("Google Chrome, Microsoft Edge, or Chromium is required for automatic Apple login");
  return match;
}

export function extractAppleCallbackFromCdpEvent(event: any, redirectUri: string): string | undefined {
  const directUrl = event?.method === "Network.requestWillBeSent"
    ? event.params?.request?.url
    : event?.method === "Page.frameRequestedNavigation"
      ? event.params?.url
      : event?.method === "Page.frameNavigated"
        ? event.params?.frame?.url
        : event?.method === "Page.navigatedWithinDocument"
          ? event.params?.url
          : undefined;
  if (isAppleIntentCallback(directUrl)) return directUrl;

  const response = event?.method === "Network.requestWillBeSent"
    ? event.params?.redirectResponse
    : event?.method === "Network.responseReceived"
      ? event.params?.response
      : undefined;
  if (!response || response.url !== redirectUri) return undefined;
  const locationEntry = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "location");
  const location = locationEntry?.[1];
  return isAppleIntentCallback(location) ? location : undefined;
}

export async function captureAppleCallback(options: CaptureAppleCallbackOptions): Promise<string> {
  if (typeof WebSocket !== "function") {
    throw new Error("Automatic Apple login requires Node.js 22 or newer");
  }
  const timeoutMillis = options.timeoutMillis ?? 10 * 60_000;
  const executable = resolveBrowserExecutable(options.browserPath);
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "baby-daybook-apple-"));
  const child = spawn(executable, [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    options.authorizationUrl,
  ], { stdio: "ignore" });

  try {
    const port = await readDevToolsPort(userDataDirectory, child, timeoutMillis);
    const target = await findPageTarget(port, options.authorizationUrl, timeoutMillis);
    return await captureFromTarget(target.webSocketDebuggerUrl, options.redirectUri, timeoutMillis);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(userDataDirectory, { recursive: true, force: true });
  }
}

async function readDevToolsPort(userDataDirectory: string, child: ChildProcess, timeoutMillis: number): Promise<number> {
  const activePortPath = path.join(userDataDirectory, "DevToolsActivePort");
  const deadline = Date.now() + Math.min(timeoutMillis, 30_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Browser exited before authentication started (${child.exitCode})`);
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).trim().split("\n");
      const port = Number(portLine);
      if (Number.isSafeInteger(port) && port > 0) return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the browser debugging endpoint");
}

async function findPageTarget(port: number, authorizationUrl: string, timeoutMillis: number): Promise<Required<Pick<ChromeTarget, "webSocketDebuggerUrl">>> {
  const deadline = Date.now() + Math.min(timeoutMillis, 30_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json() as ChromeTarget[];
        const pages = targets.filter((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
        const target = pages.find((candidate) => candidate.url === authorizationUrl || candidate.url?.startsWith("https://appleid.apple.com/"))
          ?? pages[0];
        if (target?.webSocketDebuggerUrl) return { webSocketDebuggerUrl: target.webSocketDebuggerUrl };
      }
    } catch {
      await delay(100);
      continue;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Apple sign-in browser tab");
}

async function captureFromTarget(webSocketUrl: string, redirectUri: string, timeoutMillis: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => finish(new Error("Timed out waiting for Apple sign-in to finish")), timeoutMillis);
    let settled = false;

    function finish(error?: Error, callback?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else if (callback) resolve(callback);
      else reject(new Error("Apple sign-in completed without a callback"));
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Network.enable" }));
      socket.send(JSON.stringify({ id: 2, method: "Page.enable" }));
      socket.send(JSON.stringify({ id: 3, method: "Runtime.evaluate", params: { expression: "location.href", returnByValue: true } }));
    });
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data));
        const evaluatedUrl = event?.id === 3 ? event.result?.result?.value : undefined;
        const callback = isAppleIntentCallback(evaluatedUrl)
          ? evaluatedUrl
          : extractAppleCallbackFromCdpEvent(event, redirectUri);
        if (callback) finish(undefined, callback);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.addEventListener("error", () => finish(new Error("Lost the browser debugging connection during Apple sign-in")));
    socket.addEventListener("close", () => finish(new Error("Apple sign-in browser closed before returning a credential")));
  });
}

function isAppleIntentCallback(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("intent://callback?");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
