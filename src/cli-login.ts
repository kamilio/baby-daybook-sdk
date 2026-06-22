import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { BABY_DAYBOOK_APPLE_REDIRECT_URI, createAppleAuthorizationUrl } from "./apple.js";
import { captureAppleCallback } from "./apple-browser-auth.js";
import { BabyDaybookClient } from "./client.js";
import { persistBabyDaybookSession } from "./command-service.js";

const DEFAULT_TIMEOUT_MINUTES = 30;

export interface AppleLoginOptions {
  browser?: string;
  authFile?: string;
  timeoutMinutes: number;
}

interface AppleLoginDependencies {
  captureAppleCallback: typeof captureAppleCallback;
  signInWithAppleCallback: typeof BabyDaybookClient.signInWithAppleCallback;
  persistBabyDaybookSession: typeof persistBabyDaybookSession;
  randomState(): string;
}

export function parseAppleLoginOptions(args: string[]): { help: boolean; options: AppleLoginOptions } {
  const options: AppleLoginOptions = { timeoutMinutes: DEFAULT_TIMEOUT_MINUTES };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true, options };
    if (argument === "--browser") options.browser = requiredValue(args, ++index, argument);
    else if (argument === "--auth-file") options.authFile = requiredValue(args, ++index, argument);
    else if (argument === "--timeout-minutes") options.timeoutMinutes = parseTimeout(requiredValue(args, ++index, argument));
    else throw new Error(`Unknown login option: ${argument}`);
  }
  return { help: false, options };
}

export async function runAppleLogin(
  options: AppleLoginOptions,
  dependencies: AppleLoginDependencies = {
    captureAppleCallback,
    signInWithAppleCallback: BabyDaybookClient.signInWithAppleCallback.bind(BabyDaybookClient),
    persistBabyDaybookSession,
    randomState: () => randomBytes(24).toString("base64url"),
  },
): Promise<{ authFile: string; babyCount: number }> {
  const state = dependencies.randomState();
  const authorizationUrl = createAppleAuthorizationUrl({ state });
  const callback = await dependencies.captureAppleCallback({
    authorizationUrl: authorizationUrl.href,
    redirectUri: BABY_DAYBOOK_APPLE_REDIRECT_URI,
    browserPath: options.browser,
    timeoutMillis: options.timeoutMinutes * 60_000,
  });
  if (new URL(callback).searchParams.get("state")?.trim() !== state) {
    throw new Error("Apple callback state did not match this login attempt");
  }
  const authFile = path.resolve(options.authFile ?? path.join(os.homedir(), ".config", "baby-daybook", "auth.json"));
  const persist = async (session: Parameters<typeof persistBabyDaybookSession>[1] | undefined) => {
    if (session) await dependencies.persistBabyDaybookSession(authFile, session);
  };
  const client = await dependencies.signInWithAppleCallback(callback, { onSessionChanged: persist });
  await dependencies.persistBabyDaybookSession(authFile, client.session.snapshot);
  return { authFile, babyCount: (await client.listBabies()).length };
}

export function renderLoginHelp(): string {
  return `baby-daybook login apple — Sign in with Apple and save a local CLI session

Usage: baby-daybook login apple [OPTIONS]

Options:
  --browser <path>          Chrome, Edge, or Chromium executable
  --auth-file <path>       Session file (default: ~/.config/baby-daybook/auth.json)
  --timeout-minutes <n>    Browser login timeout from 1 to 120 (default: 30)
  -h, --help               Show this help

The command opens a temporary browser profile and captures Baby Daybook's Apple callback automatically.
No callback paste step is used. Automatic login requires Node.js 22 or newer.
`;
}

function parseTimeout(value: string): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
    throw new Error("--timeout-minutes must be greater than 0 and no more than 120");
  }
  return minutes;
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}
