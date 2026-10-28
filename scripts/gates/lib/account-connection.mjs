/** Shared gate credentials use normal verified-email sessions and their HTTP token grant.
 * Browser cookies and API bearers remain distinct; no fixture mint bypass exists. */
import { randomUUID } from 'node:crypto';
import { startMailSink } from '../../lib/mail-login.mjs';

// Per-process fixture state: the signed-in browser and API caller have distinct
// credentials. Never exchange the API-scoped token for a browser session.
const browsers = new Map();
export function connectionBrowserCookie(base, token) {
  const browser = browsers.get(token);
  if (!browser || !browser.origins.includes(new URL(base).origin)) throw new Error('No signed-in browser for this fixture connection');
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

/** Grant an API credential from an existing or freshly verified email session. */
export async function connectAgent(base, { email, cookie: existingCookie } = {}) {
  const origin = new URL(base).origin;
  const cookie = existingCookie ?? (await signInAccount(origin, { ...(email ? { email } : {}) })).cookie;
  const exchange = await fetch(`${origin}/api/authentication/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin, Cookie: cookie }, body: '{}',
  });
  const granted = await exchange.json().catch(() => null);
  if (exchange.status !== 201 || typeof granted?.access_token !== 'string' || !granted.access_token) {
    throw new Error(`POST ${origin}/api/authentication/token → ${exchange.status}: email-session grant failed`);
  }
  browsers.set(granted.access_token, { origins: [origin], cookie });
  return { token: granted.access_token };
}

/**
 * The connection as a JSON API caller: `api(path, body)` POSTs as its bearer and returns the body, or throws naming
 * the path, status and text. `send` is the gate's fetch (gates author through fixture-http's fixtureFetch).
 */
export function bearerApi(base, token, send = fetch) {
  return async (path, body) => {
    const res = await send(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };
}
