/**
 * A rate-limit deny — one of only two answers a proxy gives on its own (the other is the proxy's refusal of
 * the anonymous mint to a non-browser, which is the proxy's because the app cannot see the hop the browser
 * headers arrived on). Everything else — 401s, 404s, `WWW-Authenticate` on /mcp — is the app's, because the
 * app is the one that knows what a route requires.
 *
 * Moved from packages/contract/src/deny.ts (verbatim); that file re-exports
 * this one until the package dissolves.
 */
export interface Deny {
  error: 'rate_limited';
  /** Seconds until the caller may try again. */
  retryAfter: number;
  /** Which door refused — for the caller's own diagnostics, never a secret. */
  door?: string;
}

export const DENY_STATUS = 429;

export function denyResponse(deny: Deny): Response {
  return new Response(JSON.stringify(deny), {
    status: DENY_STATUS,
    headers: { 'content-type': 'application/json', 'retry-after': String(Math.max(1, Math.ceil(deny.retryAfter))) },
  });
}

export function isDeny(body: unknown): body is Deny {
  return !!body && typeof body === 'object' && (body as Deny).error === 'rate_limited' && typeof (body as Deny).retryAfter === 'number';
}
