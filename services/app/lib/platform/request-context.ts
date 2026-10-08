/**
 * THE CURRENT REQUEST, for code that runs without one in hand — a page, an
 * analytics call, `publicOrigin()`. Held in AsyncLocalStorage by whatever
 * server is answering (the Hono server sets it per request); outside any
 * request (a direct handler call in a test) it is null and callers fall back
 * the way they always did.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ request: Request }>();

export function runWithRequest<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  return storage.run({ request }, fn);
}

export function currentRequest(): Request | null {
  return storage.getStore()?.request ?? null;
}

let headersOverride: (() => HeadersInit | null) | undefined;

/**
 * THE TEST OVERRIDE for the request a direct handler call never has: the headers `currentHeaders` answers (null =
 * off-request), asked on every call. The test harness clears it after every file; production code never sets it.
 */
export function overrideRequestHeaders(headers: (() => HeadersInit | null) | undefined): void {
  headersOverride = headers;
}

/** The current request's headers, or null off-request. Never throws. */
export async function currentHeaders(): Promise<Headers | null> {
  if (headersOverride) {
    const headers = headersOverride();
    return headers ? new Headers(headers) : null;
  }
  return currentRequest()?.headers ?? null;
}
