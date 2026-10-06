/**
 * Gate: WHO YOU ARE, AND WHAT IS YOURS — from a guest's first document to an account's shared workspace.
 *
 * No credential is ever shown to a person: the CLI's device approval (or an OAuth client's consent) is the only
 * door to one, a browser holds an httpOnly cookie and nothing in storage, and what a guest made follows them into
 * the account they verify. Each leg below is a different person, so they run at once in one browser (the
 * setup-guide leg in its own, for the system clipboard), over one mail sink:
 *
 *   start    the setup guide makes a document and copies a tokenless paste; HTTP creation hands out no
 *            credential; the browser approves the CLI for its guest; the page fills in live when the agent
 *            writes (formerly gate-simpler-start).
 *   door     the OAuth consent screen in a real browser — no guest grant, a signed-out visitor sent to log in,
 *            the form's redirect not blocked by `form-action` — the email-code door itself (no password, no
 *            code in the response, change email, one mail per request, a wrong code refused), the account-bound
 *            grant; then the CLI approved from the signed-in browser, revoked, signed out and back in
 *            (formerly gate-oauth-browser and gate-app-flows AUTH: the one login door, walked once).
 *   claim    a verified login adopts the guest's documents and keeps its CLI connection, offers nowhere to
 *            paste a token, keeps none in storage, and adopts no unrelated guest (formerly gate-claim-flow).
 *   fork     a logged-out reader's Fork survives /login and lands on their own copy, credited by the source's
 *            current tier; `?intent=fork` is no lever for a stranger; `?intent=comment` opens the rail
 *            (formerly gate-fork).
 *   folders  a folder's listing is in the first HTML byte, a child an agent publishes joins the open page live,
 *            an editor gets the verbs, a stranger never sees the private child, move/rename/card/trash/restore
 *            (formerly gate-folders).
 *   cli      the CLI's acceptance against this host: device login, guest merge into the account, dataset
 *            identities, private access, bound query, two-workspace conflict, a real PNG export
 *            (formerly gate-cli-conformance). `CONFORMANCE__CLI` substitutes the executable under test and
 *            `CONFORMANCE__CREDENTIAL_SOURCE` takes the account from the eval's credential helper instead of
 *            this browser — the reference-compatibility job's matrix.
 *
 * The fork and folders legs share one owner: an account that adopted a guest connection, the credential an
 * agent would hold. Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.
 *
 *   usage: node scripts/gates/gate-accounts-and-workspace.mjs [base]
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { documentFrame, DOCUMENT_FRAME, servedTopLevel } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import { lane } from './lib/lane.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { cliConformance } from './lib/cli-conformance.mjs';
import { becomeOwner, mergeGuestIntoAccount } from '../lib/start-doc.mjs';
import { startMailSink, loginViaEmail, isSignedInAs, passTheWelcomePage } from '../lib/mail-login.mjs';

const BASE = new URL(process.argv[2] ?? 'http://localhost:3030').origin;
const check = createChecker('accounts-and-workspace');
const stamp = Date.now().toString(36);
const sink = await startMailSink();
const browser = await launchChromium();
const context = () => browser.newContext({ viewport: { width: 1400, height: 950 } });

// ── start: the setup guide, a guest, and the agent it connects ───────────────
async function startLeg() {
  const { must, run } = lane(check, 'start');
  // `navigator.clipboard` exists only in a secure context: the app is `app.lvh.me` over http, so this browser is told to
  // treat it as secure (what `localhost` was). The headless shell ignores the switch; the full browser honours it.
  const secureArgs = [`--unsafely-treat-insecure-origin-as-secure=${BASE}`];
  const own = await launchChromium({ channel: 'chrome', headless: true, args: secureArgs })
    .catch(() => launchChromium({ channel: 'chromium', headless: true, args: secureArgs }));
  try {
    await run(async () => {
      const page = await own.newPage({ viewport: { width: 1280, height: 900 } });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await page.goto(`${BASE}/docs-human`, { waitUntil: 'load' });
      const create = page.getByRole('button', { name: 'Create a live document for my agent', exact: true });
      await create.waitFor();
      const startRespP = page.waitForResponse((r) => r.url().includes('/api/start') && r.request().method() === 'POST', { timeout: 30_000 });
      await create.click();
      const startRes = await startRespP;
      const started = await startRes.json();
      await page.waitForFunction(id => navigator.clipboard.readText().then(text => text.includes(`/a/${id}`)), started.id);
      const prompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');

      const id = started.id;
      must(!!id, 'the create button makes a real document');
      check(!('token' in started) && !('expiresAt' in started), 'and the API body hands out NO credential and no expiry');
      check(!/mx_/.test(JSON.stringify(started)), 'nothing token-shaped rides the response at all');
      check(/HttpOnly/i.test((await startRes.allHeaders())['set-cookie'] ?? ''), 'guest ownership stays in an HttpOnly cookie');
      // The COPIED paste is tokenless and points at afbin — the agent-facing surface carries no secret.
      check(/\/a\/[A-Za-z0-9]+/.test(prompt), 'the copied paste names the artifact URL');
      check(!/mx_[A-Za-z0-9_-]+/.test(prompt), 'and carries NO token inline (afbin authenticates itself)');
      check(!/\/start\?k=/.test(prompt), 'and carries no start link');
      check(prompt.length < 600 && prompt.includes("\n\n---\n\nLet's build an artifact for "), `and includes a short editable brief (${prompt.length} chars)`);
      check(prompt.includes('afbin'), 'the paste points to the afbin CLI (afbin authenticates itself; no setup step)');
      check(prompt.includes('/chat/ensure-node.sh') && prompt.includes('/chat/ensure-node.ps1') && prompt.includes('npx --yes @afbin/cli@latest setup') && prompt.includes('afbin help'), 'and says how to prepare Node, install afbin through npm and run it');

      // The retired doors (the start-link brief, its claim door, the public anonymous mint) answering 404 are HTTP
      // facts with no browser in them: services/app/server/__tests__/docs-human.test.ts asserts them on the app server.

      // ── the agent's leg: connect the way afbin does, then write ──
      // OSS has the same artifact API for browser and HTTP clients; creation never
      // grants a credential. Device approval still owns CLI authentication.
      const bareStart = await fetch(`${BASE}/api/start`, { method: 'POST' });
      const bareDocument = await bareStart.json();
      check(bareStart.status === 201 && !!bareDocument.id, 'an HTTP client can create a document without browser-only policy');
      check(!('token' in bareDocument) && !('expiresAt' in bareDocument) && !/mx_/.test(JSON.stringify(bareDocument)),
        'HTTP creation hands out no credential or expiry');
      check(/HttpOnly/i.test(bareStart.headers.get('set-cookie') ?? ''), 'guest creation sets an HttpOnly ownership cookie');
      // The start door is the thing under test, so this leg cannot use the shared
      // start helper — it walks the same two steps by hand.
      const agent = await connectAgent(BASE);
      check(/^mx_/.test(agent.token ?? ''), 'the CLI device approval is the only way a credential exists');
      const approval = await (await fetch(`${BASE}/api/agent-approvals`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ artifactId: id }),
      })).json();
      await page.goto(approval.verification_uri_complete);
      await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
      await page.getByRole('heading', { name: 'Access approved', exact: true }).waitFor();
      const granted = await fetch(`${BASE}/api/agent-approvals/token`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ device_code: approval.device_code }),
      });
      const connection = await granted.json();
      check(granted.ok && !!connection.access_token, 'the browser connects the CLI to its guest user');
      agent.token = connection.access_token;

      await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
      const put = await fetch(`${BASE}/api/artifacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({
          title: 'gate doc',
          markup: '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Landed by the agent</h1></div>',
          theme: 'modernist',
        }),
      });
      check(put.status === 200, `the connection edits the original browser-created artifact (PUT ${put.status})`);

      /**
       * Is this text on screen, wherever the document happens to be? A no-runtime document RELOADS to show a live
       * update, which destroys the execution context mid-poll: that is the update arriving, not a failure.
       */
      const seenInFrame = async (p, text) => {
        for (let i = 0; i < 60; i++) {
          for (const frame of p.frames()) {
            if (await frame.getByRole('heading', { name: text, exact: true }).isVisible().catch(() => false)) return true;
          }
          await p.waitForTimeout(500);
        }
        console.error('live document did not display the heading', await Promise.all(p.frames().map(async frame => ({
          url: frame.url(), body: (await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 800),
        }))));
        return false;
      };
      check(await seenInFrame(page, 'Landed by the agent'), "the watching human's page updated live");
    });
  } finally {
    await own.close();
  }
}

// ── door: consent, the email-code door, and the connections an account holds ─
/*
 * Unit tests POST to /oauth/authorize/approve directly and pass happily — but a browser also enforces the page's
 * Content-Security-Policy, and `form-action` applies to the WHOLE redirect chain of a form submission. A CSP of
 * `form-action 'self'` therefore blocks the 303 back to the OAuth client and the user just sits on the consent
 * page. That shipped to production and made every connector impossible to complete while every scripted test
 * passed. So this leg clicks the button like a person does, and requires the code to arrive at a real listener.
 */
async function doorLeg() {
  const { must, run } = lane(check, 'door');
  const callbacks = [];
  const listener = createServer((req, res) => { callbacks.push(new URL(req.url, 'http://127.0.0.1')); res.end('ok'); });
  // An OS-allocated port: two runs of this gate on one machine (the compatibility matrix) cannot collide.
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const REDIRECT = `http://127.0.0.1:${listener.address().port}/cb`;
  const ctx = await context();
  try {
    await run(async () => {
      const page = await ctx.newPage();
      page.on('dialog', (d) => d.accept());
      const cspViolations = [];
      page.on('console', (m) => { if (/Content Security Policy|form-action/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });

      await page.goto(BASE, { waitUntil: 'load' });
      await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/login', 'logged-out home visits reach the login page');

      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const registration = await (await fetch(`${BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'OAuth browser gate', redirect_uris: [REDIRECT] }),
      })).json();
      const clientId = registration.client_id;
      must(/^afbin_/.test(clientId ?? ''), 'the browser gate dynamically registered its client');
      await page.goto(`${BASE}/oauth/authorize?${new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
        code_challenge: challenge, code_challenge_method: 'S256', state: 'gate-state',
      })}`, { waitUntil: 'load' });
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

      // ── the email-code door, walked by hand: the one login this leg makes ──
      const email = `mxmx_test_oauth_${stamp}@example.com`;
      // Parallel gates share one outbox, so the inbox is not ours alone; the unique address is the ownership boundary.
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
      must(/^\d{6}$/.test(code0 ?? ''), 'a 6-digit code arrived by email');
      check(mine().length === 2, `one email per request, including the re-send after change-email (${mine().length})`);

      // A wrong code must not log anyone in.
      await page.fill('[aria-label="Login code"]', code0 === '000000' ? '111111' : '000000');
      await page.click('[aria-label="Verify code"]');
      await page.waitForTimeout(1500);
      check(page.url().includes('/login'), 'a wrong code keeps you on the login page');

      await page.fill('[aria-label="Login code"]', code0);
      await page.click('[aria-label="Verify code"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).catch(() => {});
      check(!new URL(page.url()).pathname.startsWith('/login'), 'logged in with the code');
      const cookies = await page.context().cookies();
      check(cookies.some((c) => /better-auth.*session_token|authjs.session-token/.test(c.name)), 'a session cookie was set');
      // One flow for both: a verified code for an unknown address creates the account.
      check(await isSignedInAs(page, email), 'a first login with a code creates the account and signs you in');
      check((await page.locator('[aria-label="Password"]').count()) === 0, 'no password is asked for anywhere');
      // A brand-new account meets the welcome page once, as a person does (lib/mail-login).
      await passTheWelcomePage(page, email);

      // ── the account-bound OAuth grant ──
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
        const artifacts = await fetch(`${BASE}/api/artifacts`, { headers: { Authorization: `Bearer ${tok2.access_token}` } });
        check(artifacts.status === 200 && Array.isArray((await artifacts.json()).artifacts), 'the account grant reads the real HTTP API');
      }

      // ── CONNECTING THE CLI from the signed-in browser ──
      // The only way a credential exists, so this is how an agent's work lands in an account: the signed-in browser
      // approves the device pairing, and everything that connection publishes belongs to the account from the
      // start — there is nothing to paste and nothing to claim.
      const pairing = await (await fetch(`${BASE}/oauth/device`, { method: 'POST' })).json();
      await page.goto(`${BASE}/oauth/device?user_code=${encodeURIComponent(pairing.user_code)}`, { waitUntil: 'load' });
      check((await page.locator('body').innerText()).includes(pairing.user_code), 'the approval page shows the code the terminal displayed');
      await page.click('button[type=submit]');
      await page.waitForTimeout(1500);
      check((await page.locator('body').innerText()).includes('Connection approved'), 'a signed-in browser approves the connection');
      const granted = await (await fetch(`${BASE}/oauth/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code: pairing.device_code }) })).json();
      const accountToken = granted.access_token;
      must(typeof accountToken === 'string' && accountToken.length > 0, 'the terminal receives its credential');
      const published = await fetch(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ title: 'Connected artifact', markup: '<h1>connected</h1>' }) });
      must(published.status === 201, `the connection publishes its artifact (${published.status})`);
      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      // The Solid dashboard loads its account listing after navigation; load + a fixed delay
      // did not imply that listing had arrived under concurrent CI load.
      must(await page.getByText('Connected artifact', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false), 'what the connection publishes appears on the dashboard');
      await page.goto(`${BASE}/account`, { waitUntil: 'load' });
      const revoke = page.locator('[aria-label^="Revoke token"]').first();
      // Account hydration fetches connections after navigation. An 800ms sleep plus
      // count() sampled that asynchronous state too early under distribution CI load.
      // Wait for the actual affordance, then retain the real revocation assertion.
      must(await revoke.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false), 'the connections panel offers revoke');
      await revoke.click();
      const revoked = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith('/api/my/tokens/'));
      await page.getByLabel('Confirm revoke', { exact: true }).click();
      must((await revoked).ok(), 'the connection revocation succeeds');
      check((await fetch(`${BASE}/api/artifacts`, { headers: { Authorization: `Bearer ${accountToken}` } })).status === 401, 'a revoked connection stops working');
      await openMenu(page);
      await page.click('[aria-label="Sign out"]'); await page.waitForTimeout(3000);
      await page.waitForURL(`${BASE}/login`);
      check(!(await isSignedInAs(page, email)) && await page.getByRole('textbox', { name: 'Email', exact: true }).isVisible(), 'sign out clears the session and returns to login');
      // Logging back in to the SAME address must reuse the account, not make a second.
      await loginViaEmail(page, BASE, sink, email);
      check(await isSignedInAs(page, email), 'log back in with a fresh code works');
    });
  } finally {
    await ctx.close();
    listener.close();
  }
}

// ── claim: a verified login adopts what the guest made ───────────────────────
async function claimLeg() {
  const { must, run } = lane(check, 'claim');
  const ctx = await context();
  await run(async () => {
    const p = await ctx.newPage();
    const api = async (path, init = {}, token) => (await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    })).json();
    // An anonymous visitor makes two documents.
    const anon = await connectAgent(BASE);
    const doc = async (title) => api('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({ title, markup: `<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">${title}</h1></div>` }),
    }, anon.token);
    const kept = await doc('Quarterly Review');
    const left = await doc('Scratch Notes');
    must(!!kept.id && !!left.id, 'an anonymous visitor published two documents');

    // The browser holds the guest's httpOnly session cookie, and the shell it unlocks belongs to the owner.
    await p.goto(BASE, { waitUntil: 'load' });
    await becomeOwner(p, BASE, anon.token);

    // They log in.
    const email = `mxmx_test_claim_${stamp}@example.com`;
    await loginViaEmail(p, BASE, sink, email);
    // The page chrome names the account by HANDLE, not by address, so being signed in is asked of the session endpoint.
    check(await isSignedInAs(p, email), 'logging in with an emailed code signs you in');

    // Guest ownership transfers during verified login, without a second claim UI.
    check(await p.locator('[aria-label="Unclaimed drafts"]').count() === 0, 'guest drafts are adopted automatically on verified login');
    // And there is NOWHERE to paste a credential: the account page lists CLI
    // connections to revoke, and nothing anywhere asks a person for a token.
    await p.goto(`${BASE}/account`, { waitUntil: 'load' });
    await p.waitForTimeout(1000);
    check((await p.locator('[aria-label="Token to claim"]').count()) === 0, 'the account page asks for no pasted token');
    check(!/mx_\.\.\./.test(await p.locator('body').innerText()), 'and offers no token field at all');

    // Credentials remain in HttpOnly cookies, never browser-readable storage.
    const stored = await p.evaluate(() => [localStorage.getItem('mx_tokens'), localStorage.getItem('mx_token')]);
    check(stored.every((v) => v === null), 'the browser keeps no token in localStorage');
    const cookies = await p.context().cookies(BASE);
    check(cookies.some((c) => /mx-agent-session/.test(c.name) && c.httpOnly), 'it holds an httpOnly session cookie instead');

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const mine = await (await fetch(`${BASE}/api/my/artifacts`, { headers: { cookie: cookieHeader } })).json();
    const titles = (mine.artifacts ?? []).map((a) => a.title).sort();
    check(titles.includes('Quarterly Review') && titles.includes('Scratch Notes'), `both documents now belong to the account (${titles.join(', ')})`);

    // The token still edits, and the offer does not come back.
    const stillEdits = await api(`/api/artifacts/${kept.id}`, { method: 'PUT', body: JSON.stringify({ markup: '<h1>Updated after login</h1>' }) }, anon.token);
    check(stillEdits.id === kept.id, 'the connected CLI still edits after guest ownership transfers');
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    check((await p.locator('[aria-label="Unclaimed drafts"]').count()) === 0, 'and the banner does not nag again once the drafts are claimed');

    // An unrelated guest is neither adopted nor claimable by an account.
    const stranger = await connectAgent(BASE);
    const unrelated = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Not Yours', markup: '<h1>Not Yours</h1>', visibility: 'private' }) }, stranger.token);
    const cannotRead = await fetch(`${BASE}/api/my/artifacts/${unrelated.id}`, { headers: { cookie: cookieHeader } });
    check(cannotRead.status === 404, 'login did not adopt an unrelated guest identity');
    const cannotClaim = await fetch(`${BASE}/api/tokens/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ token: stranger.token }),
    });
    check(cannotClaim.status === 404, 'the legacy claim endpoint cannot take another guest user token');
  });
  await ctx.close();
}

// ── the workspace owner fork and folders share ───────────────────────────────
/** An account that adopted a guest connection: its pages, and the agent's bearer. */
async function workspaceOwner() {
  const { must, run } = lane(check, 'owner');
  const ctx = await context();
  let owner = null;
  await run(async () => {
    const page = await ctx.newPage();
    await loginViaEmail(page, BASE, sink, `mxmx_test_workspace_owner_${stamp}@example.com`);
    must(Boolean((await ctx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'owner logged in');
    // The owner's token — guest-owned, then adopted by the verified session. This is what stands in for the AGENT:
    // the same credential an agent would hold.
    const anon = await connectAgent(BASE);
    must(await mergeGuestIntoAccount(page, BASE, anon.token) === 200, 'owner adopted the guest connection');
    const api = async (path, body) => {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
      return res.json();
    };
    owner = { ctx, page, api, newPage: async () => { const p = await ctx.newPage(); await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); return p; } };
  });
  return owner;
}

// ── fork, and the `?intent=` round trip that carries it through login ────────
/*
 * What only a browser can prove is that the halves are ONE journey: a logged-out reader is served the app page
 * with the document framed on its own origin, so the fork control they see is the app bar's, and the ask has to
 * survive a top navigation, a login, a canonical redirect and a mount before anything happens.
 */
async function forkLeg(owner) {
  const { must, step, run } = lane(check, 'fork');
  const FORKER_EMAIL = `mxmx_test_fork_${stamp}@example.com`;
  const forkerCtx = await context();
  await run(async () => {
    const ownerPage = await owner.newPage();
    const forker = await forkerCtx.newPage();
    // ── 1. a public document, published by the owner's own adopted token ──
    const doc = await owner.api('/api/artifacts', {
      title: 'Fork gate',
      visibility: 'public',
      markup: '<div class="p-8"><h1>Fork gate</h1><p>The original, published by its owner.</p></div>',
    });
    must(doc.visibility === 'public', 'a PUBLIC document — the case a stranger can reach at all');

    // ── 2. the parameter is not a lever on a shared link ──
    const strangerHtml = await (await fetch(`${BASE}/a/${doc.id}?intent=fork`)).text();
    // The app page carries none of the document now: it names it in its head and draws its frame (lib/serving/document-frame).
    check(strangerHtml.includes('<title>Fork gate') && strangerHtml.includes('data-mx-document-frame'),
      'an anonymous ?intent=fork still receives the document page (its title, its frame)');
    check((strangerHtml.match(/<iframe\b/g) ?? []).length === 1 && !strangerHtml.includes('<iframe title="artifact"'), 'the shared SPA supplies the authenticated fork action, around the one document frame and no other iframe');

    // ── 3. the logged-out reader taps Fork on the app's bar ──
    await forker.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
    const strangerFrame = await documentFrame(forker);
    const original = await strangerFrame.getByText('The original, published by its owner.').waitFor({ timeout: 20000 }).then(() => true, () => false);
    check(original, 'a logged-out reader reads the document in its frame');
    const forkAnchor = forker.locator('[aria-label="Fork artifact"]');
    await step('the app bar offers Fork directly', () => forkAnchor.waitFor({ state: 'visible', timeout: 10000 }));

    // ── 4. the ask survives the top navigation into /login ──
    await forkAnchor.click();
    await forker.getByLabel('Confirm fork', { exact: true }).click();
    await forker.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20000 });
    check(decodeURIComponent(new URL(forker.url()).searchParams.get('callbackUrl') ?? '').includes('intent=fork'), 'the login door carries the ask back with it');
    // The login form, driven WHERE IT ALREADY IS: `loginViaEmail` navigates to /login first, which would throw away
    // the callbackUrl the fork anchor just put there — and the callbackUrl is the thing under test.
    await forker.waitForSelector('[aria-label="Email"]', { timeout: 20000 });
    await forker.fill('[aria-label="Email"]', FORKER_EMAIL);
    await forker.click('[aria-label="Log in with email"]');
    await forker.waitForSelector('[aria-label="Login code"]', { timeout: 15000 });
    const code = sink.lastCode(FORKER_EMAIL);
    must(code, `a login code reached the development outbox for ${FORKER_EMAIL}`);
    await forker.fill('[aria-label="Login code"]', code);
    await forker.click('[aria-label="Verify code"]');

    // ── 5. returned to the document, with the confirm open ──
    const dialog = forker.getByRole('dialog', { name: 'Fork this artifact?', exact: true });
    await step('login returned them to the document with the fork confirm open', () => dialog.waitFor({ state: 'visible', timeout: 30000 }));
    check(!new URL(forker.url()).search.includes('intent='), 'the instruction is consumed: the address no longer carries it, so a refresh does not re-prompt');
    const forkEndpoint = `${BASE}/api/my/artifacts/${doc.id}/fork`;
    let forkResult;
    // Read the real response before delivering it: the UI immediately navigates, which can discard
    // Chromium's response body before a waitForResponse caller can read it.
    await forker.route(forkEndpoint, async (route) => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.dry_run === true) return route.continue();
      const response = await route.fetch();
      forkResult = await response.json();
      await route.fulfill({ response });
    });
    const [forkResponse] = await Promise.all([
      forker.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/my/artifacts/${doc.id}/fork`
        && response.request().postDataJSON()?.dry_run !== true, { timeout: 30000 }),
      forker.locator('[aria-label="Confirm fork"]').click(),
    ]);
    must(forkResponse.status() === 201, `fork creates the copy (${forkResponse.status()})`);
    await forker.unroute(forkEndpoint);
    const copyPath = new URL(forkResult.url, BASE).pathname;
    // Welcome is an intentional intermediate destination for this new account, not the copy's address.
    await forker.waitForURL((u) => u.pathname === copyPath
      || (u.pathname === '/welcome' && new URL(u.searchParams.get('callbackUrl') ?? '', BASE).pathname === copyPath), { timeout: 30000 });
    check(copyPath.startsWith('/@'), `the copy is at its new owner's address (${copyPath})`);

    // ── 6. the copy is theirs, and says where it came from ──
    const copyId = forkResult.id;
    // The new reader can still be navigating (or handing a new account to Welcome).
    // Use the browser context's authenticated request instead of its unloading page.
    const copyResponse = await forker.request.get(`${BASE}/api/my/artifacts/${copyId}`);
    check(copyResponse.ok(), `the fork owner can read the new copy (${copyResponse.status()})`);
    const copyRow = await copyResponse.json();
    check(copyRow.forked_from === doc.id, `the copy records its source (forked_from = ${copyRow.forked_from})`);
    check(copyRow.id !== doc.id, 'a new id — the original is untouched');
    // Let the copy navigation (and its possible Welcome redirect) settle, then confirm through Welcome like a person.
    await forker.waitForLoadState('networkidle');
    await passTheWelcomePage(forker, FORKER_EMAIL);
    await forker.waitForURL((u) => u.pathname === copyPath, { timeout: 30_000 });
    await forker.locator(DOCUMENT_FRAME).waitFor({ state: 'attached', timeout: 30_000 });
    await openArtifactControls(forker);
    const credit = forker.locator('[data-mx-forked-from]');
    await credit.waitFor({ state: 'visible', timeout: 30000 });
    const creditText = await credit.innerText();
    check(creditText.toLowerCase().includes('forked from'), `the copy's credits name its source ("${creditText.trim()}")`);
    check(creditText.includes(doc.id), 'and the source is named by its address, not vaguely');

    // ── 6b. the naming follows the SOURCE's tier, re-asked on every render ──
    // The owner narrows the source AFTER the fork: `unlisted` exists to be listed nowhere, so a copy somebody else
    // made public must stop republishing its address — measured as a STRANGER, who is who reads a shared copy.
    const narrowed = await ownerPage.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ visibility: 'unlisted' }),
    })).status, doc.id);
    check(narrowed === 200, 'the owner narrowed the source to unlisted');
    const strangerCopy = await (await fetch(`${BASE}/a/${copyId}`)).text();
    check(!strangerCopy.includes(doc.id), "a stranger reading the copy no longer sees the unlisted source's address");
    await forker.reload();
    await openArtifactControls(forker);
    check((await forker.locator('[data-mx-forked-from]').innerText()).includes('forked from a document that is not public'),
      '…and the controls show the same neutral sentence a private or deleted source gets');

    // ── 7. `intent=comment` opens the conversation for an invited commenter ──
    const invited = await ownerPage.evaluate(async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ shares: [{ email, role: 'commenter' }] }),
    })).status, [doc.id, FORKER_EMAIL]);
    check(invited === 200, 'the owner invited them as a commenter');
    await forker.goto(`${BASE}/a/${doc.id}?intent=comment`, { waitUntil: 'load' });
    await step('?intent=comment opens the comment rail for a commenter', () => forker.locator('[aria-label="Annotation sidebar"]').waitFor({ state: 'visible', timeout: 30000 }));
    check(!new URL(forker.url()).search.includes('intent='), '…and that instruction is consumed too');
    await ownerPage.close();
  });
  await forkerCtx.close();
}

// ── folders: a folder's page, to its owner, an editor and a stranger ─────────
/*
 * A folder has no content. Its listing is app data — answered by the page endpoint, inlined into the HTML by the
 * app server, drawn by web/pages/Folder over the shelf the dashboard already has. Everything that makes that a
 * good idea is a delivery property no unit test can see.
 */
async function foldersLeg(owner) {
  const { must, step, run } = lane(check, 'folders');
  const EDITOR_EMAIL = `mxmx_test_folders_editor_${stamp}@example.com`;
  const editorCtx = await context();
  const strangerCtx = await context();
  await run(async () => {
    const ownerPage = await owner.ctx.newPage();
    const o = ownerPage;
    const editor = await editorCtx.newPage();
    const stranger = await strangerCtx.newPage();
    // A PAGE THAT THREW IS STILL A PAGE FULL OF LOCATORS THAT FIND NOTHING, and only the message says which.
    const errors = [];
    for (const [who, p] of [['owner', o], ['stranger', stranger]]) p.on('pageerror', (e) => errors.push(`${who}: ${String(e).slice(0, 160)}`));
    await loginViaEmail(editor, BASE, sink, EDITOR_EMAIL);
    must(Boolean((await editorCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'editor logged in');

    // ── the folder, and one child of each kind ──
    const folder = await owner.api('/api/artifacts', { format: 'folder', title: 'Field Notes', visibility: 'public' });
    must(folder.format === 'folder' && folder.visibility === 'public', 'a public folder, created with no content');
    check(!folder.markup, 'and the create echo hands back no markup nobody sent');
    const seen = await owner.api('/api/artifacts', {
      title: 'Opening Note', visibility: 'public', parent_id: folder.id,
      markup: '<div class="p-8"><h1>Opening Note</h1><p>the first note.</p></div>',
    });
    check(seen.parent_id === folder.id, 'a public document is filed under it at publish');
    await owner.api('/api/artifacts', { title: 'Quiet Note', parent_id: folder.id, markup: '<div class="p-8"><h1>Quiet Note</h1></div>' });
    // "raw is the uniform 404 for a folder" is an HTTP fact: folder-page.test.ts "has no document to serve: raw AND
    // the live frame are the uniform 404" asserts it on the routes.

    // ── 1. the listing is in the FIRST HTML BYTE ──
    // `page.goto` waits, so a listing that arrives a second late still finds every locator. This reads the BYTES
    // the server sent, with the owner's own cookies, before a single script has run.
    // Playwright's shared keep-alive socket can close after the login/setup gap.
    // Its maxRetries retries ECONNRESET only, never HTTP errors: this read-only
    // SSR assertion still requires 200 and both authorized children in the bytes.
    const firstBytes = await owner.ctx.request.get(`${BASE}/a/${folder.id}`, { maxRetries: 1 });
    check(firstBytes.status() === 200, 'the owner’s folder address answers 200');
    const html = await firstBytes.text();
    check(html.includes('Opening Note') && html.includes('Quiet Note'), 'both children are in the FIRST HTML byte, before any script runs');
    check(html.includes('Field Notes'), 'and so is the folder’s own name');

    await o.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    check(await servedTopLevel(o), 'a folder is never framed — it has no document');
    await step('the owner’s page draws both children', async () => {
      await o.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
      await o.locator('[aria-label^="Open Quiet Note"]').waitFor({ timeout: 20000 });
    });
    const head = () => o.locator('header').filter({ has: o.locator('[aria-label="Folder trail"]') }).first().textContent();
    const headText = (await head()) ?? '';
    check(headText.includes('Field Notes'), `the page names the folder it is (${headText.trim().slice(0, 60)})`);
    check(/2 documents/.test(headText), `and counts what is on the shelf, as a sentence (${headText.trim().slice(0, 60)})`);

    // ── 2. Folder from the workspace creation menu ──
    await step('the folder made from the bar lands INSIDE this one, with no navigation', async () => {
      await o.getByRole('button', { name: 'Create', exact: true }).click();
      await o.getByRole('menuitem', { name: 'Folder', exact: true }).click();
      await o.getByRole('dialog', { name: 'Create new folder' }).getByLabel('Folder name').fill('Archive');
      await Promise.all([
        o.waitForResponse((r) => r.url().endsWith('/api/my/artifacts') && r.request().method() === 'POST' && r.status() === 201, { timeout: 15000 }),
        o.getByRole('dialog', { name: 'Create new folder' }).getByLabel('Folder name').press('Enter'),
      ]);
      await o.locator('[aria-label="Open folder Archive"]').waitFor({ timeout: 20000 });
    });

    // ── 2b. an EMPTY folder is an invitation, not a blank page ──
    // A tile just CREATED carries the create reply's absolute url; one the server listed carries `/a/<id>`.
    const archiveHref = await o.locator('[aria-label="Open folder Archive"]').getAttribute('href');
    const archiveId = archiveHref.split('/').pop();
    await o.goto(new URL(archiveHref, BASE).toString(), { waitUntil: 'load' });
    await o.locator('[aria-label="Empty folder"]').waitFor({ timeout: 20000 });
    const emptyText = (await o.locator('[aria-label="Empty folder"]').textContent()) ?? '';
    check(emptyText.includes('Nothing here yet.'), 'an empty folder says it is empty');
    check(emptyText.includes('menu') && emptyText.includes(`parent_id: "${archiveId}"`), `and names both ways to fill it (${emptyText.trim().slice(0, 90)})`);
    // NESTED, so it draws the trail — and the crumb is a link back up.
    const crumb = o.locator('[aria-label="Folder trail"] a');
    check((await crumb.count()) === 2, 'a nested folder draws Home and its parent above its name');
    check(new URL(await crumb.last().getAttribute('href'), BASE).pathname === `/a/${folder.id}`, 'and the crumb links to the folder above it');
    // The camera's element has to be VISIBLE even here: `main` is what `/a/<id>/export` names, and an element with
    // no height is a 15-second `waitFor` and then `render_failed`.
    const mainBox = await o.locator('main').first().boundingBox();
    check(Boolean(mainBox) && mainBox.height > 0, 'an empty folder still paints a <main> for the camera to photograph');

    const liveStream = o.waitForResponse((response) => new URL(response.url()).pathname === `/a/${folder.id}/events`);
    await o.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    await o.locator('[aria-label="Open folder Archive"]').waitFor({ timeout: 20000 });
    check((await liveStream).status() === 200, 'the live folder stream is subscribed before publishing');

    // ── 3. an agent's publish reaches the open page, live ──
    // Mark the page: a reload loses the mark, and that is what "live" has to mean.
    await o.evaluate(() => { window.__gateMark = 'kept'; });
    const live = await owner.api('/api/artifacts', {
      title: 'Live Note', visibility: 'public', parent_id: folder.id,
      markup: '<div class="p-8"><h1>Live Note</h1></div>',
    });
    await step('a document published by an agent joins the OPEN folder listing', () => o.locator('[aria-label^="Open Live Note"]').waitFor({ timeout: 20000 }));
    check(await o.evaluate(() => window.__gateMark === 'kept'), 'and it arrived with no page reload');

    // ── 4. an editor, and a stranger ──
    // A folder page carries no share menu of its own — sharing is the row's, from the shelf that lists it — so the
    // invite goes through the browser door the menu would have called.
    const shared = await o.evaluate(async ({ id, email }) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shares: [{ email, role: 'editor' }] }),
    })).status, { id: folder.id, email: EDITOR_EMAIL });
    check(shared === 200, `the folder is shared with the editor (${shared})`);
    await editor.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    await step('an invited editor opens the same folder page', () => editor.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 }));
    check((await editor.locator('[aria-label="New folder"]').count()) === 1, 'and may make a folder inside it');
    check((await editor.locator('[aria-label="Rename folder"]').count()) === 1, 'and may rename it');
    // An editor reads the folder as an insider: the shelf is the whole shelf.
    check((await editor.locator('[aria-label^="Open Quiet Note"]').count()) === 1, 'an editor sees the private child too');

    const strangerVisit = await stranger.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    check(strangerVisit.status() === 200, 'a stranger may open the public folder');
    await stranger.waitForSelector('[aria-label^="Open Opening Note"]', { timeout: 20000 });
    check((await stranger.locator('[aria-label="New folder"]').count()) === 0, 'with none of the owner’s verbs');
    check((await stranger.locator('[aria-label="Rename folder"]').count()) === 0, 'and no way to rename it');
    check(!(await stranger.textContent('body')).includes('Quiet Note'), 'a private child is listed to NOBODY without a role');

    // ── 5. the picker moves the document out of its current folder ──
    await o.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    const openMove = async () => {
      await o.locator('[aria-label="More actions for Live Note"]').first().click();
      await o.locator('[aria-label="Move Live Note"]').first().click();
    };
    await openMove();
    await o.waitForSelector('[aria-label="Filter folders"]', { timeout: 5000 }).catch(async () => {
      await openMove();
      await o.waitForSelector('[aria-label="Filter folders"]', { timeout: 15000 });
    });
    check((await o.locator('[aria-label="Move to Field Notes"]').count()) === 1, 'the picker offers the account’s folders by name');
    await Promise.all([
      o.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/artifacts/${live.id}/edits`) && r.status() === 200, { timeout: 15000 }),
      o.locator('[aria-label="Move to root"]').first().click(),
    ]);
    const moved = await o.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), live.id);
    check(moved.parent_id === null, 'moving to root really files it at the root');
    await o.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    await o.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
    check((await o.locator('[aria-label^="Open Live Note"]').count()) === 0, 'and the folder stops listing it');

    // ── 6. the dashboard strip ──
    await o.goto(`${BASE}/`, { waitUntil: 'load' });
    await step('the dashboard lists the folder in its own strip', async () => {
      await o.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
      await o.locator('[aria-label="Open folder Field Notes"]').waitFor({ timeout: 15000 });
    });
    // Deleting a folder is deleting everything in it, so the row SAYS how much before anyone clicks.
    await o.locator('[aria-label="More actions for Field Notes"]').first().click();
    const del = o.locator('[aria-label="Delete Field Notes"]').first();
    await del.waitFor({ timeout: 15000 });
    check(((await del.textContent()) ?? '').includes('inside'), 'the row says how much is in it');
    // …and RENAME is the verb that replaced the editor a folder never had.
    check((await o.locator('[aria-label="Rename Field Notes"]').count()) === 1, 'the tile menu offers rename');
    check((await o.locator('[aria-label="Edit Field Notes"]').count()) === 0, 'and no editor, because a folder has nothing to edit');
    await o.keyboard.press('Escape');

    // ── 6b. the owner's profile stays a public listing ──
    const handle = await o.evaluate(async () => (await (await fetch('/api/my/profile')).json()).username);
    await o.goto(`${BASE}/@${handle}`, { waitUntil: 'load' });
    await o.waitForSelector('[aria-label="Search artifacts"]', { timeout: 20000 });
    check((await o.locator('[aria-label="New folder"]').count()) === 0, 'the owner’s public profile withholds workspace creation controls');
    check((await o.locator('[aria-label="Current page"]').textContent()).includes(`@${handle}`), 'the page bar names the profile by its handle');
    check((await o.locator('[aria-label="Move Field Notes"]').count()) === 0, 'without granting the row verbs a profile withholds');

    // ── 7. renaming happens on the NAME, through the metadata door (PATCH {title}) ──
    await o.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
    await o.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
    await o.locator('[aria-label="Rename folder"]').click();
    await o.fill('[aria-label="Folder name"]', 'Field Notes 2026');
    await Promise.all([
      o.waitForResponse((r) => r.url().includes(`/api/my/artifacts/${folder.id}`) && r.request().method() === 'PATCH' && r.status() === 200, { timeout: 15000 }),
      o.getByLabel('Folder name', { exact: true }).press('Enter'),
    ]);
    const renamed = await o.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), folder.id);
    check(renamed.title === 'Field Notes 2026', `the name renames the folder in place (${renamed.title})`);
    check(((await head()) ?? '').includes('Field Notes 2026'), 'and the head shows the new name at once');

    // ── 8. the folder's own og card renders from the APP PAGE ──
    // The camera goes to `/a/<id>?key=` with `main` as its target, where a document is photographed at `raw?chrome=0`.
    const card = await owner.ctx.request.get(`${BASE}/a/${folder.id}/export?mode=card`);
    const cardBytes = (await card.body()).length;
    check(card.status() === 200 && (card.headers()['content-type'] ?? '').startsWith('image/'),
      `the folder's og card renders (${card.status()} ${card.headers()['content-type']})`);
    check(cardBytes > 2000, `and it is a real picture, not a refusal (${cardBytes} bytes)`);

    // ── 9. deleting a folder from the strip trashes it WITH its contents ──
    await o.goto(`${BASE}/`, { waitUntil: 'load' });
    await o.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
    await o.getByRole('button', { name: 'More actions for Field Notes 2026', exact: true }).first().click();
    await o.locator('[aria-label="Delete Field Notes 2026"]').first().click();
    const confirmText = await o.getByRole('dialog').innerText();
    await Promise.all([
      o.waitForResponse((r) => r.request().method() === 'DELETE' && r.status() === 200, { timeout: 15000 }),
      o.getByLabel('Confirm delete', { exact: true }).click(),
    ]);
    check(/inside it\? They go to the trash, and you can restore them any time\./.test(confirmText), `the confirm names what goes with it (${confirmText})`);
    await step('the tile leaves the strip with no reload', () => o.locator('[aria-label="Open folder Field Notes 2026"]').waitFor({ state: 'detached', timeout: 15000 }));
    // Read back through the OWNER's own door: a trashed row is the uniform 404 even to the person who trashed it.
    const gone = await o.evaluate(async (ids) => {
      const status = {};
      for (const [name, id] of Object.entries(ids)) status[name] = (await fetch(`/api/my/artifacts/${id}`)).status;
      return status;
    }, { folder: folder.id, child: seen.id });
    check(gone.folder === 404 && gone.child === 404, `the folder and its child are gone, subtree and all (${gone.folder}/${gone.child})`);
    const address = await owner.ctx.request.get(`${BASE}/a/${folder.id}`);
    check(address.status() === 404, `and the folder's own address is the uniform 404 (${address.status()})`);
    const trash = await o.evaluate(async () => (await (await fetch('/api/page/trash')).json()));
    const inTrash = new Set((trash.files ?? []).map((f) => f.id));
    check(inTrash.has(folder.id) && inTrash.has(seen.id), 'and both are listed in the trash');

    // The Trash route is a separate Solid entry: its browser handoff and restore action, arriving from the shelf.
    await o.goto(`${BASE}/trash`, { waitUntil: 'load' });
    const trashTable = o.getByRole('table');
    await trashTable.getByText('Field Notes 2026').first().waitFor({ timeout: 20000 });
    check((await trashTable.innerText()).includes('Field Notes 2026'), 'the Solid Trash route renders the deleted folder');
    await o.getByRole('button', { name: 'More actions for Field Notes 2026' }).click();
    await step('the Solid route restores the folder and updates its table', async () => {
      await Promise.all([
        o.waitForResponse((r) => r.url().endsWith(`/api/my/artifacts/${folder.id}/restore`) && r.status() === 200, { timeout: 15000 }),
        o.getByRole('button', { name: 'Restore Field Notes 2026' }).click(),
      ]);
      await trashTable.getByText('Field Notes 2026').first().waitFor({ state: 'detached', timeout: 15000 });
    });
    check(errors.length === 0, `no page error on either render of the listing${errors.length ? ` — ${errors[0]}` : ''}`);
    await ownerPage.close();
  });
  await editorCtx.close();
  await strangerCtx.close();
}

// ── cli: portable CLI/HTTP acceptance against this host — scripts/gates/lib/cli-conformance.mjs, shared with the
// standalone scripts/gate-cli-conformance.mjs a downstream deployment runs against its own host.
const cliLeg = () => cliConformance({ base: BASE, check, stamp, sink, context });

const started = Date.now();
await Promise.all([
  startLeg(),
  doorLeg(),
  claimLeg(),
  workspaceOwner().then((owner) => owner && Promise.all([forkLeg(owner), foldersLeg(owner)])),
  cliLeg(),
]);
check.note(`six legs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await browser.close();
sink.close();
check.done();
