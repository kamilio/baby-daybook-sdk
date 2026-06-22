import { describe, expect, it } from "vitest";
import { extractAppleCallbackFromCdpEvent, resolveBrowserExecutable } from "../src/apple-browser-auth.js";

const redirectUri = "https://example.test/apple";
const callback = "intent://callback?code=code&id_token=token#Intent;end";

describe("Apple browser authentication", () => {
  it("extracts direct and redirected Apple intent callbacks", () => {
    expect(extractAppleCallbackFromCdpEvent({
      method: "Network.responseReceived",
      params: { response: { url: redirectUri, headers: { Location: callback } } },
    }, redirectUri)).toBe(callback);
    expect(extractAppleCallbackFromCdpEvent({
      method: "Network.requestWillBeSent",
      params: { redirectResponse: { url: redirectUri, headers: { location: callback } } },
    }, redirectUri)).toBe(callback);
    for (const event of [
      { method: "Network.requestWillBeSent", params: { request: { url: callback } } },
      { method: "Page.frameRequestedNavigation", params: { url: callback } },
      { method: "Page.frameNavigated", params: { frame: { url: callback } } },
      { method: "Page.navigatedWithinDocument", params: { url: callback } },
    ]) expect(extractAppleCallbackFromCdpEvent(event, redirectUri)).toBe(callback);
  });

  it("ignores unrelated redirects and resolves reviewed browser candidates", () => {
    expect(extractAppleCallbackFromCdpEvent({
      method: "Network.responseReceived",
      params: { response: { url: "https://other.test", headers: { location: callback } } },
    }, redirectUri)).toBeUndefined();
    expect(extractAppleCallbackFromCdpEvent({
      method: "Network.responseReceived",
      params: { response: { url: redirectUri, headers: { location: "https://example.test/other" } } },
    }, redirectUri)).toBeUndefined();
    expect(resolveBrowserExecutable(undefined, [process.execPath])).toBe(process.execPath);
    expect(() => resolveBrowserExecutable("/definitely/missing/browser", [])).toThrow("does not exist");
    expect(() => resolveBrowserExecutable(undefined, [])).toThrow("Chrome, Microsoft Edge, or Chromium");
  });
});
