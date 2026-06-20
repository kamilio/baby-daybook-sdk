import { BabyDaybookApiError } from "./errors.js";
import type { FetchLike } from "./types.js";

export async function requestJson<T>(
  fetcher: FetchLike,
  input: string,
  init: RequestInit = {},
  ErrorType: typeof BabyDaybookApiError = BabyDaybookApiError,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch (cause) {
    throw new ErrorType(`Request failed: ${input}`, { cause });
  }

  const text = await response.text();
  let body: any;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const error = body?.error;
    const message = typeof error === "string"
      ? error
      : error?.message ?? body?.message ?? `${response.status} ${response.statusText}`;
    throw new ErrorType(message, {
      status: response.status,
      code: error?.status ?? error?.code,
      details: error?.details ?? body,
    });
  }
  return body as T;
}

export function jsonHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  return headers;
}
