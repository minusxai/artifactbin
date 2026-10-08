/**
 * A CREDENTIAL FOR A GATE — through the one door the product has.
 *
 * No client mints its own token: the ONLY way a client obtains a
 * credential is the afbin CLI's OAuth device approval, approved in the
 * browser. A gate is a test driving the product, so it walks exactly that
 * flow over HTTP — sign in with email, approve the pairing from that
 * browser session, then exchange the device code for the bearer.
 *
 * The point of the helper is that the three calls are written ONCE. Every gate
 * that needs "an agent with its own connection" gets it here, and when the
 * flow changes there is one place to change.
 *
 * Needs authentication composed with the app (it owns the OAuth routes): a
 * gate pointed at `npm run dev:app` alone has no device door.
 */

import { randomUUID } from 'node:crypto';
import { startMailSink } from '../../lib/mail-login.mjs';

// Per-process fixture state: the approving browser and the CLI have distinct
// credentials. Never exchange the API-scoped CLI token for a browser session.
const browsers = new Map();
export function connectionBrowserCookie(base, token) {
  const browser = browsers.get(token);
  if (!browser || !browser.origins.includes(new URL(base).origin)) throw new Error('No approving browser for this fixture connection');
  return browser.cookie;
}

/** An actual email login, with the code read from the protected test mailbox. */
export async function signInAccount(base, { origin = new URL(base).origin, sink, email = `mxmx_test_connection_${randomUUID()}@example.com` } = {}) {
  sink ??= await startMailSink();
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const sent = await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  if (!sent.ok) throw new Error(`Email login code request failed (${sent.status})`);
  let otp = sink.lastCode(email);
  const deadline = Date.now() + 5_000;
  while (!otp && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    otp = sink.lastCode(email);
  }
  if (!otp) throw new Error('Email login code did not reach the protected outbox');
  const verified = await post('/api/auth/sign-in/email-otp', { email, otp });
  if (!verified.ok) throw new Error(`Email login verification failed (${verified.status})`);
  const cookie = verified.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Email login did not establish an account session');
  const confirmed = await fetch(`${base}/api/my/profile`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify({ welcome_pending: false }) });
  if (!confirmed.ok) throw new Error(`Account onboarding failed (${confirmed.status})`);
  return { cookie };
}

/** Approve a fresh account connection, retaining its browser credential for gates. */
export async function connectAgent(base, { email, cookie: existingCookie } = {}) {
  const origin = new URL(base).origin;
  const begin = await fetch(`${origin}/oauth/device`, { method: 'POST' });
  const pairing = await begin.json().catch(() => null);
  if (!begin.ok || !pairing?.device_code || !pairing?.user_code) {
    throw new Error(`POST ${origin}/oauth/device → ${begin.status}: ${JSON.stringify(pairing)}`);
  }

  const advertised = new URL(pairing.verification_uri ?? pairing.verification_url ?? origin).origin;
  const cookie = existingCookie ?? (await signInAccount(origin, { origin: advertised, ...(email ? { email } : {}) })).cookie;
  const approve = await fetch(`${origin}/oauth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: advertised, Cookie: cookie },
    body: new URLSearchParams({ user_code: pairing.user_code, decision: 'approve' }),
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
  browsers.set(granted.access_token, { origins: [origin, advertised], cookie });
  return { token: granted.access_token };
}
