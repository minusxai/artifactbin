/**
 * A CREDENTIAL FOR A GATE — through the one door the product has.
 *
 * No client mints its own token: the ONLY way a client obtains a
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
 * Needs authentication composed with the app (it owns the OAuth routes): a
 * gate pointed at `npm run dev:app` alone has no device door.
 */

// Per-process fixture state: the approving browser and the CLI have distinct
// credentials. Never exchange the API-scoped CLI token for a browser session.
const browsers = new Map();
export function connectionBrowserCookie(base, token) {
  const browser = browsers.get(token);
  if (!browser || !browser.origins.includes(new URL(base).origin)) throw new Error('No approving browser for this fixture connection');
  return browser.cookie;
}

/** Approve a fresh guest connection, retaining its browser credential for gates. */
export async function connectAgent(base) {
  const origin = new URL(base).origin;
  const begin = await fetch(`${origin}/oauth/device`, { method: 'POST' });
  const pairing = await begin.json().catch(() => null);
  if (!begin.ok || !pairing?.device_code || !pairing?.user_code) {
    throw new Error(`POST ${origin}/oauth/device → ${begin.status}: ${JSON.stringify(pairing)}`);
  }

  // What the browser sends when a person clicks "Continue anonymously": the
  // form, from the product's own origin (the route refuses any other). That is
  // the origin the product ADVERTISES — carried in the pairing's verification
  // URI — not whatever address this script dialed (127.0.0.1 vs localhost
  // was a 403 invalid_origin in CI).
  const advertised = new URL(pairing.verification_uri ?? pairing.verification_url ?? origin).origin;
  const approve = await fetch(`${origin}/oauth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: advertised },
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
  const cookie = approve.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Guest approval did not establish a browser session');
  browsers.set(granted.access_token, { origins: [origin, advertised], cookie });
  return { token: granted.access_token };
}
