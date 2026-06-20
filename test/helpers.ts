import { vi } from "vitest";
import type { FetchLike } from "../src/types.js";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mockFetch(...responses: Array<Response | ((url: string, init?: RequestInit) => Response | Promise<Response>)>): FetchLike & ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const response = responses[index++];
    if (!response) throw new Error(`Unexpected request ${String(input)}`);
    return typeof response === "function" ? response(String(input), init) : response;
  }) as FetchLike & ReturnType<typeof vi.fn>;
}

export function jwt(payload: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}
