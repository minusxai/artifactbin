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
 * Connecting the MCP now requires an ACCOUNT, so the gate also logs in the way
 * a user does: email → one-time code, read from a local mail sink. Start the
 * dev server pointed at it:
 *
 *   EMAIL__RESEND_API_KEY=x EMAIL__RESEND_BASE_URL=http://127.0.0.1:4598 npm run dev
 */
import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const PORT = 9987;
const REDIRECT = `http://127.0.0.1:${PORT}/cb`;
const callbacks = [];
const server = createServer((req, res) => { callbacks.push(new URL(req.url, `http://127.0.0.1:${PORT}`)); res.end('ok'); });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// Local Resend-compatible sink: the login code arrives by the real send path.
const SINK_PORT = 4598;
const inbox = [];
const sink = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try { inbox.push(JSON.parse(body)); } catch { /* not our shape */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((r) => sink.listen(SINK_PORT, '127.0.0.1', r));

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeUrl = `${BASE}/oauth/authorize?${new URLSearchParams({
  response_type: 'code', client_id: 'artifact-bin-mcp', redirect_uri: REDIRECT,
  code_challenge: challenge, code_challenge_method: 'S256', state: 'gate-state',
})}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const cspViolations = [];
page.on('console', (m) => { if (/Content Security Policy|form-action/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });

await page.goto(authorizeUrl, { waitUntil: 'load' });
check(/Connect to artifact-bin/.test(await page.locator('body').innerText()), 'the consent screen renders');

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
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.fill('[aria-label="Email"]', email);
  await page.click('[aria-label="Log in with email"]');
  await page.waitForSelector('[aria-label="Login code"]', { timeout: 10_000 });

  const code0 = /\b(\d{6})\b/.exec(inbox.at(-1)?.text ?? '')?.[1];
  check(!!code0, 'the login code arrived by email');
  await page.fill('[aria-label="Login code"]', code0 ?? '');
  await page.click('[aria-label="Verify code"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).catch(() => {});
  check(!new URL(page.url()).pathname.startsWith('/login'), 'logged in with the code');

  const before = callbacks.length;
  const v2 = randomBytes(32).toString('base64url');
  const c2 = createHash('sha256').update(v2).digest('base64url');
  await page.goto(`${BASE}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: 'artifact-bin-mcp', redirect_uri: REDIRECT,
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
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: 'artifact-bin-mcp', code_verifier: v2 }),
    })).json();
    check(/^mx_/.test(tok2.access_token ?? ''), 'the account-bound grant exchanges for a token');

    const mcp = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok2.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    check(mcp.status === 200 && (await mcp.text()).includes('create_artifact'), 'and that token opens a real MCP session');
  }
}

await browser.close();
sink.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('\nall oauth-browser gates passed');
