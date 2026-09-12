/**
 * A CREDENTIAL FOR A GATE — through the one door the product has.
 *
 * There is no mint endpoint any more: the ONLY way any client obtains a
 * credential is the afbin CLI's OAuth device approval, approved in the
 * browser. A gate is a test driving the product, so it walks exactly that
 * flow over HTTP — begin the pairing, approve it anonymously (the
 * "Continue anonymously" button of `/oauth/device`, posted with the page's
 * own Origin), then exchange the device code for the bearer.
 *
 * The point of the helper is that the three calls are written ONCE. Every gate
 * that needs "an agent with its own connection" gets it here, and when the
 * flow changes there is one place to change.
 *
 * Needs the proxy in front of the app (the OAuth routes are the proxy's): a
 * gate pointed at `npm run dev:app` alone has no device door.
 */

/** Approve a fresh anonymous CLI connection and return its bearer: `{ token }`. */
export async function connectAgent(base) {
  const origin = new URL(base).origin;
  const begin = await fetch(`${origin}/oauth/device`, { method: 'POST' });
  const pairing = await begin.json().catch(() => null);
  if (!begin.ok || !pairing?.device_code || !pairing?.user_code) {
    throw new Error(`POST ${origin}/oauth/device → ${begin.status}: ${JSON.stringify(pairing)}`);
  }

  // What the browser sends when a person clicks "Continue anonymously": the
  // form, from the product's own origin (the route refuses any other).
  const approve = await fetch(`${origin}/oauth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ user_code: pairing.user_code, decision: 'anonymous' }),
  });
  if (!approve.ok) {
    throw new Error(`POST ${origin}/oauth/device/approve → ${approve.status}: ${(await approve.text()).slice(0, 200)}`);
  }

  const exchange = await fetch(`${origin}/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: pairing.device_code }),
  });
  const granted = await exchange.json().catch(() => null);
  if (!exchange.ok || !granted?.access_token) {
    const hint = exchange.status === 429
      ? ' (the oauth_token rate limit — wait for the window or restart the server; the limiter is in memory)'
      : '';
    throw new Error(`POST ${origin}/oauth/device/token → ${exchange.status}${hint}: ${JSON.stringify(granted)}`);
  }
  return { token: granted.access_token };
}
