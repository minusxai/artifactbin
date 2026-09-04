/**
 * MINTING AN ANONYMOUS TOKEN FROM A GATE — one helper, fourteen scripts.
 *
 * `POST /api/tokens/anonymous` is the WEB PAGE's own mint, and the proxy in front of the app now refuses it
 * to anything that is not a browser (proxy `anonMintDoor`): an agent that mints its own token publishes
 * documents its human cannot reach, so no agent-facing surface names that address any more. A gate is
 * neither — it is a test driving the product, standing in for the page — so it sends what the page sends:
 * `origin: <base>` plus `sec-fetch-site: same-origin`, both MEASURED off Chromium on the real `/tokens/new`.
 *
 * The point of the helper is that those two headers are written ONCE. Fourteen copies of them would be
 * fourteen places to forget when the door changes, and the first symptom would be a 403 in an unrelated gate.
 *
 * `/api/start` is NOT this door and needs no headers — it shares only the rate limit.
 */

/** What Chromium sends on the page's own mint fetch, for `base`. */
export function browserMintHeaders(base) {
  return { 'Content-Type': 'application/json', origin: new URL(base).origin, 'sec-fetch-site': 'same-origin' };
}

/** The raw Response, for a caller that wants to read the status itself (a 429 says the limiter, not the door). */
export function mintAnonResponse(base, init = {}) {
  return fetch(`${base}/api/tokens/anonymous`, {
    method: 'POST',
    ...init,
    headers: { ...browserMintHeaders(base), ...(init.headers ?? {}) },
  });
}

/**
 * The mint answer — `{ id, token, expiresAt, note }` — or a thrown error naming the status, because a gate
 * that carries on with `undefined` as its token fails later and somewhere else.
 */
export async function mintAnon(base, init = {}) {
  const res = await mintAnonResponse(base, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    const hint = res.status === 429
      ? ' (the ANON_MINT rate limit — wait for the window or restart the server; the limiter is in memory)'
      : res.status === 403
        ? ' (the browser-context door — this helper should have carried the page\'s headers)'
        : '';
    throw new Error(`POST ${base}/api/tokens/anonymous → ${res.status}${hint}: ${JSON.stringify(body)}`);
  }
  return body;
}
