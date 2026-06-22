import { describe, expect, it, vi } from "vitest";
import { parseAppleLoginOptions, renderLoginHelp, runAppleLogin } from "../src/cli-login.js";
import type { BabyDaybookClient } from "../src/client.js";

describe("Baby Daybook CLI login", () => {
  it("parses automatic Apple login options without a paste mode", () => {
    expect(parseAppleLoginOptions([
      "--browser", "/browser",
      "--auth-file", "/auth.json",
      "--timeout-minutes", "45",
    ])).toEqual({
      help: false,
      options: { browser: "/browser", authFile: "/auth.json", timeoutMinutes: 45 },
    });
    expect(parseAppleLoginOptions(["--help"]).help).toBe(true);
    expect(() => parseAppleLoginOptions(["--callback", "intent://callback"])).toThrow("Unknown login option");
    expect(() => parseAppleLoginOptions(["--timeout-minutes", "0"])).toThrow("greater than 0");
    expect(renderLoginHelp()).toContain("No callback paste step is used");
  });

  it("captures a state-bound Apple callback and persists the rotating session", async () => {
    const persist = vi.fn(async () => undefined);
    const callback = "intent://callback?state=fixed-state&code=code&id_token=id#Intent;end";
    const client = {
      session: { snapshot: { userId: "user", refreshToken: "refresh", expiresAt: 1, idToken: "id" } },
      listBabies: vi.fn(async () => [{ uid: "baby-1" }, { uid: "baby-2" }]),
    } as unknown as BabyDaybookClient;
    const capture = vi.fn(async () => callback);
    const signIn = vi.fn(async (_callback, options) => {
      await options?.onSessionChanged?.(client.session.snapshot);
      return client;
    });

    await expect(runAppleLogin({ authFile: "/tmp/auth.json", timeoutMinutes: 12 }, {
      captureAppleCallback: capture,
      signInWithAppleCallback: signIn,
      persistBabyDaybookSession: persist,
      randomState: () => "fixed-state",
    })).resolves.toEqual({ authFile: "/tmp/auth.json", babyCount: 2 });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      browserPath: undefined,
      timeoutMillis: 12 * 60_000,
      redirectUri: expect.stringContaining("signInWithAppleAndroid"),
    }));
    expect(signIn).toHaveBeenCalledWith(callback, expect.any(Object));
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("rejects a callback from another login attempt", async () => {
    await expect(runAppleLogin({ timeoutMinutes: 30 }, {
      captureAppleCallback: vi.fn(async () => "intent://callback?state=wrong&code=code&id_token=id#Intent;end"),
      signInWithAppleCallback: vi.fn(),
      persistBabyDaybookSession: vi.fn(),
      randomState: () => "expected",
    })).rejects.toThrow("state did not match");
  });
});
