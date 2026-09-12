/**
 * The OAuth consent screen in a REAL browser:
 *
 *   node scripts/gate-oauth-browser.mjs [base]
 *
 * Unit tests POST to /oauth/authorize/approve directly and pass happily — but
 * a browser also enforces the page's Content-Security-Policy, and `form-action`
 * applies to the WHOLE redirect chain of a form submission. A CSP of
 * `form-action 'self'` therefore blocks the 303 back to the OAuth client and
 * the user just sits on the consent page. That shipped to production and made
 * every connector (ChatGPT, Claude) impossible to complete, while every
 * scripted test still passed.
 *
 * So this gate clicks the button like a person does, and requires the code to
 * arrive at a real listener on the client side.
 *
 * Connecting the CLI now requires an ACCOUNT, so the gate also logs in the way
 * a user does, and the whole email-code door is proved on the way through:
 * no password field, a send response that carries no code, the change-email
 * escape hatch sending exactly one mail per request, a wrong code refused, and
 * the session cookie actually landing. The unit tests cover the code store and
 * the form's state machine separately; the seam between them — the send route,
 * the Better Auth round trip, the cookie, and the consent screen recognising
 * that session — is what this gate is for. The code comes from the development
 * mail outbox written by the real send path:
 *
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { chromium } from 'playwright';
import { startMailSink } from './lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const PORT = 9987;
const REDIRECT = `http://127.0.0.1:${PORT}/cb`;
const callbacks = [];
const server = createServer((req, res) => { callbacks.push(new URL(req.url, `http://127.0.0.1:${PORT}`)); res.end('ok'); });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const sink = await startMailSink();

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const registration = await (await fetch(`${BASE}/oauth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'OAuth browser gate', redirect_uris: [REDIRECT] }),
})).json();
const clientId = registration.client_id;
check(/^afbin_/.test(clientId ?? ''), 'the browser gate dynamically registered its client');
const authorizeUrl = `${BASE}/oauth/authorize?${new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
  code_challenge: challenge, code_challenge_method: 'S256', state: 'gate-state',
})}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const cspViolations = [];
page.on('console', (m) => { if (/Content Security Policy|form-action/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });

await page.goto(authorizeUrl, { waitUntil: 'load' });
check(/Connect to artifactbin/.test(await page.locator('body').innerText()), 'the consent screen renders');

// The guest grant is gone: a token minted here would go to the CLIENT and never
// be shown to the human, so nothing could ever claim what it publishes.
const signedOutHtml = await page.content();
check(!signedOutHtml.includes('Continue without an account'), 'no guest grant is offered');
check(!signedOutHtml.includes('value="guest"'), 'and none is hiding in a form field');

// Click it the way a human does — no form.submit(), no synthetic dispatch.
await page.click('button[type=submit]');
await page.waitForURL((u) => u.pathname === '/login', { timeout: 10_000 }).catch(() => {});
check(new URL(page.url()).pathname === '/login', `a signed-out visitor is sent to log in (at ${page.url()})`);
check(
  (new URL(page.url()).searchParams.get('callbackUrl') ?? '').includes('/oauth/authorize'),
  'and will be returned to the consent screen afterwards',
);
check(callbacks.length === 0, 'nothing was minted for a signed-out visitor');
check(cspViolations.length === 0, `no CSP violation blocks the submission${cspViolations.length ? ` (${cspViolations[0]})` : ''}`);

// ── Now do it as a real account: log in with an emailed code, then approve. ──
{
  const email = `mxmx_test_oauth_${Date.now().toString(36)}@example.com`;
  /*
   * Parallel gates share one outbox, so the inbox is not ours alone; the
   * unique address is the ownership boundary.
   */
  const mine = () => sink.inbox.filter((m) => m.to === email);

  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email', { exact: true }).waitFor({ state: 'visible' });
  check(await page.locator('[aria-label="Email"]').isVisible(), 'the login page asks for an email');
  check((await page.locator('[aria-label="Password"]').count()) === 0, 'there is no password field anywhere');

  await page.fill('[aria-label="Email"]', email);
  const codeResponse = page.waitForResponse((r) => r.url().includes('/api/auth/email-otp/send-verification-otp'));
  await page.click('[aria-label="Log in with email"]');
  const requested = await codeResponse;
  const requestedBody = await requested.text();
  check(requested.status() === 200, `the OTP door answered 200 (${requested.status()})`);
  // The code exists only in the mail the real send path wrote: no endpoint in
  // the app reveals a live one, not even to an admin.
  check(!/\d{6}/.test(requestedBody), `the response body carries NO code (${requestedBody})`);
  await page.waitForSelector('[aria-label="Login code"]', { timeout: 10_000 });

  // The typo escape hatch, and the send-once rule that goes with it.
  await page.click('[aria-label="Change email"]');
  await page.waitForSelector('[aria-label="Email"]');
  check(await page.inputValue('[aria-label="Email"]') === email, 'change email returns to a prefilled, editable field');
  await page.click('[aria-label="Log in with email"]');
  await page.waitForSelector('[aria-label="Login code"]', { timeout: 10_000 });

  const code0 = sink.lastCode(email);
  check(/^\d{6}$/.test(code0 ?? ''), 'a 6-digit code arrived by email');
  check(mine().length === 2, `one email per request, including the re-send after change-email (${mine().length})`);

  // A wrong code must not log anyone in.
  await page.fill('[aria-label="Login code"]', code0 === '000000' ? '111111' : '000000');
  await page.click('[aria-label="Verify code"]');
  await page.waitForTimeout(1500);
  check(page.url().includes('/login'), 'a wrong code keeps you on the login page');

  await page.fill('[aria-label="Login code"]', code0 ?? '');
  await page.click('[aria-label="Verify code"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).catch(() => {});
  check(!new URL(page.url()).pathname.startsWith('/login'), 'logged in with the code');
  const cookies = await page.context().cookies();
  check(cookies.some((c) => /better-auth.*session_token|authjs.session-token/.test(c.name)), 'a session cookie was set');

  const before = callbacks.length;
  const v2 = randomBytes(32).toString('base64url');
  const c2 = createHash('sha256').update(v2).digest('base64url');
  await page.goto(`${BASE}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: c2, code_challenge_method: 'S256', state: 'user-state',
  })}`, { waitUntil: 'load' });
  const signedIn = await page.locator('body').innerText();
  check(/belong to/.test(signedIn), 'a signed-in user sees the account-bound consent');
  check(signedIn.includes(email), 'naming the account the artifacts will belong to');

  await page.click('[aria-label="Approve connection"]');
  for (let i = 0; i < 60 && callbacks.length === before; i++) await page.waitForTimeout(100);
  const cb2 = callbacks[callbacks.length - 1];
  check(callbacks.length > before && !!cb2?.searchParams.get('code'), 'the signed-in form reaches the client callback');
  check(cspViolations.length === 0, 'still no CSP violation on the account-bound form');

  const code2 = cb2?.searchParams.get('code');
  if (code2) {
    const tok2 = await (await fetch(`${BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: clientId, code_verifier: v2 }),
    })).json();
    check(/^mx_/.test(tok2.access_token ?? ''), 'the account-bound grant exchanges for a token');

    const artifacts = await fetch(`${BASE}/api/artifacts`, {headers:{Authorization:`Bearer ${tok2.access_token}`}});
    check(artifacts.status===200 && Array.isArray((await artifacts.json()).artifacts),'the account grant reads the real HTTP API');

  }
}

await browser.close();
sink.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('\nall oauth-browser gates passed');
