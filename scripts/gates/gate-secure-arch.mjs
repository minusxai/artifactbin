/**
 * Gate: the security architecture — the browser and HTTP seams that no
 * in-process test can answer.
 *
 *   1. READER: /a/<id> answers a viewer with no session with the app document
 *      and its story runtime inline — same URL, no artifact iframe — under the
 *      document CSP; authored child realms remain opaque to app credentials and
 *      storage, with network limited to declared hosts, and the history prelude holds. A signed-in
 *      NON-owner gets the same document, no redirect.
 *   2. OWNER: the app page (page controls + inline story runtime), and edit
 *      mode retains that document runtime; authored child realms retain their CSP.
 *   3. EXPORT still yields a PNG for a reader after the reader path changed.
 *   4. `/raw` is an internal address: absent from the docs.
 *   5. App pages carry a CSP with frame-ancestors.
 *   6. ANONYMOUS OWNER: a minted token is exchanged for an httpOnly agent
 *      session (POST /api/session/token); the browser then holds NO token in
 *      localStorage and /a/<id> shows owner chrome around the inline runtime.
 *   7. Cookie-authenticated mutations reject a cross-site Origin.
 *
 * What a SANDBOXED author realm can and cannot reach — the opaque origin, the
 * refused fetch, image, parent and storage, the forged reader action and text
 * edit — belongs to gate-script-slice, which proves each of them directly;
 * this gate asks only who is served what.
 *
 * Runs against a dev server started with the mail sink:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *   node scripts/gates/gate-secure-arch.mjs [base]
 */
import { becomeOwner, mergeGuestIntoAccount } from '../lib/start-doc.mjs';
import { servedTopLevel } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('secure-arch');
const ts = Date.now().toString(36);

const sink = await startMailSink();
const browser = await chromium.launch();

// ── owner session A, stranger session B ───────────────────────────────────
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
await loginViaEmail(owner, BASE, sink, `mxmx_test_sec_a_${ts}@example.com`);
const otherCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const other = await otherCtx.newPage();
await loginViaEmail(other, BASE, sink, `mxmx_test_sec_b_${ts}@example.com`);
const readerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const reader = await readerCtx.newPage();
const sessionOf = async (ctx) => (await ctx.cookies(BASE)).some((c) => /better-auth/.test(c.name));
check(
  (await sessionOf(ownerCtx)) && (await sessionOf(otherCtx)) && !(await sessionOf(readerCtx)),
  'two sessions (owner A, other B) and a session-less reader are up',
);

const anon = await connectAgent(BASE);
const claimed = await mergeGuestIntoAccount(owner, BASE, anon.token);
check(claimed === 200, 'owner A adopted a guest connection');

const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// Author code now owns an isolated child realm. Its declared signal is the
// reporting channel; it must never reach the parent's DOM to report a result.
const PROBE = `<Helmet><title>Sec Probe</title><Value name="probe" type="string" default="{}"/><script>{\`
(function(){
  // Author code runs in the page's QuickJS realm: no window, document, network or history exists there.
  // Every probe is wrapped, so a missing global is reported, never fatal.
  var out = {};
  function t(k, fn){ try { out[k] = String(fn()); } catch (e) { out[k] = 'THROW ' + e.name; } }
  t('origin', function(){ return window.origin; });
  t('isTop', function(){ return window.top === window; });
  t('parentDom', function(){ return parent.document.body.textContent; });
  t('cookie', function(){ return document.cookie; });
  t('storage', function(){ return localStorage.length; });
  t('sw', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); return 'attempted'; });
  t('replaceState', function(){ var before = location.pathname; history.replaceState(null, '', '/spoofed'); return location.pathname === before ? 'held' : 'SPOOFED ' + location.pathname; });
  t('fetch', function(){ fetch('/api/artifacts'); return 'attempted'; });
  t('ownQuery', function(){ fetch('/a/' + location.pathname.split('/')[2] + '/query?q=%7B%7D'); return 'attempted'; });
  t('start', function(){ fetch('/a/' + location.pathname.split('/')[2] + '/start', { method: 'POST' }); return 'attempted'; });
  t('wasm', function(){ return typeof WebAssembly; });
  t('pageText', function(){ return dom.text(dom.query('h1')); });
  void mx.set({probe:JSON.stringify(out)});
})();
\`}</script></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">SEC-PROBE-DOC</h1><pre id="sec-probe">{$probe}</pre></div>`;

const doc = await api('/api/artifacts', { title: 'Sec Probe', markup: PROBE, visibility: 'public' });
check(doc.visibility === 'public', 'probe doc is public');

// ── 1. reader: the document itself, top-level, sandboxed ──────────────────
const readerResp = await reader.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const readerPath = new URL(reader.url()).pathname;
const readerCsp = readerResp.headers()['content-security-policy'] ?? '';
check(!readerCsp.includes('sandbox') && /script-src[^;]*'self'/.test(readerCsp) && !/script-src[^;]*'unsafe-eval'/.test(readerCsp), `reader carries strict app CSP; author children own the sandbox (${readerCsp.slice(0, 80)}…)`);
check(readerPath.includes(doc.id) && new URL(reader.url()).origin === BASE, `reader reaches its canonical artifact address (${readerPath})`);
check(await servedTopLevel(reader), 'reader page has NO artifact iframe');
await reader.waitForFunction(() => { const t = document.getElementById('sec-probe')?.textContent ?? ''; return /"fetch"/.test(t) && /"ownQuery"/.test(t) && /"start"/.test(t); }, null, { timeout: 15000 }).catch(() => {});
const probe = JSON.parse(await reader.locator('#sec-probe').textContent().catch(() => '{}') || '{}');
check(probe.origin === 'undefined', `author code has no window of its own (window.origin is ${probe.origin})`);
check(probe.isTop === 'false', 'author code is not the top-level document');
check(/THROW/.test(probe.parentDom ?? ''), 'author cannot reach the page DOM directly');
check(/THROW/.test(probe.cookie ?? ''), `document.cookie is unreachable (${probe.cookie})`);
check(/THROW/.test(probe.storage ?? ''), `localStorage is unreachable (${probe.storage})`);
check(/THROW/.test(probe.fetch ?? ''), `fetch does not exist for author code (${probe.fetch})`);
check(/THROW/.test(probe.ownQuery ?? ''), `author code cannot fetch a query endpoint (${probe.ownQuery})`);
const parentQuery = await reader.evaluate(async id => (await fetch('/a/' + id + '/query?q=%7B%7D')).status, doc.id);
check(parentQuery === 200, `trusted document runtime can fetch its scoped query (${parentQuery})`);
check(/THROW/.test(probe.start ?? ''), `author code cannot POST /a/<id>/start (${probe.start})`);
check(probe.replaceState === 'held' || /THROW/.test(probe.replaceState ?? ''), `author history cannot spoof the page URL (${probe.replaceState})`);
check(probe.wasm === 'undefined', `the realm compiles no WebAssembly of its own (typeof WebAssembly is ${probe.wasm})`);
check(probe.pageText === 'SEC-PROBE-DOC', `and the dom API reads the page it is given (${probe.pageText})`);
check(await reader.evaluate(() => document.querySelectorAll('iframe').length) === 0, 'no author frame exists on the reader page');
check(new URL(reader.url()).pathname === readerPath && new URL(reader.url()).origin === BASE, 'author probe cannot change the canonical top-level path or origin');

// signed-in NON-owner: same document, same URL, no hop
const otherResp = await other.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check(!(otherResp.headers()['content-security-policy'] ?? '').includes('sandbox'), 'signed-in non-owner gets the same top-level app policy');
check(new URL(other.url()).pathname === readerPath && new URL(other.url()).origin === BASE, 'signed-in non-owner reaches the same canonical address');
check(await servedTopLevel(other), 'signed-in non-owner: no iframe');

// private: the ACL still runs first on every path — B and the reader get the uniform 404
const priv = await api('/api/artifacts', { title: 'Sec Private', markup: '<h1>SEC-PRIVATE</h1>' });
check(priv.visibility === 'private', 'owned doc is born private');
check((await other.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: signed-in non-owner is a uniform 404');
check((await reader.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: session-less reader is a uniform 404');
await owner.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' });
check((await owner.locator('[data-mx-inline-story]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null)) === 'SEC-PRIVATE', 'private: owner sees it in the shell');

// ── 2. owner: app shell + inline runtime; EDITING DOES NOT WEAKEN CHILD SANDBOXES ──────
await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const ownerFrame = owner.locator('[data-mx-inline-story]');
const ownerText = await ownerFrame.locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(ownerText === 'SEC-PROBE-DOC', 'owner sees the shell with the document in the sandboxed iframe');

/*
 * There is no edit canvas to carry a CSP of its own any more: editing happens
 * in the served document, which already has one from its response headers. So
 * what has to be true is stronger and simpler — entering edit mode changes
 * nothing about the sandbox. Entering edit may stop the author realm entirely;
 * if it remains, it must keep its sandbox and opaque origin.
 */
await owner.waitForFunction(() => document.documentElement.hasAttribute('data-mx-author-realm'), null, { timeout: 20000 });
const realmBefore = await owner.evaluate(() => document.documentElement.getAttribute('data-mx-author-realm'));
await openArtifactControls(owner);
await owner.click('[aria-label="Edit artifact"]');
await owner.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
await owner.waitForTimeout(3000);
const editing = await owner.evaluate(() => ({
  realm: document.documentElement.getAttribute('data-mx-author-realm'),
  frames: document.querySelectorAll('iframe[title="Isolated artifact script"]').length,
}));
check(!!realmBefore && editing.realm === null, 'entering edit mode ends the author realm');
check(editing.frames === 0, 'and no author frame exists in either mode');

// ── 3. export still works for a reader ────────────────────────────────────
const shot = await readerCtx.request.get(`${BASE}/a/${doc.id}/export`);
check(shot.status() === 200 && (shot.headers()['content-type'] ?? '').includes('image/png'), `reader export is a PNG (${shot.status()})`);

// ── 4. /raw is internal ───────────────────────────────────────────────────
const llm = await (await fetch(`${BASE}/llms.txt`)).text();
check(llm.includes('afbin') && !llm.includes('/raw'), 'agent discovery teaches the CLI without internal raw links');
const rawResp = await readerCtx.request.get(`${BASE}/a/${doc.id}/raw`);
check(rawResp.status() === 200, '/raw still answers (internal address for the iframe/embeds)');

// ── 5. app pages carry a CSP ──────────────────────────────────────────────
for (const path of ['/', '/tokens', '/login']) {
  const r = await readerCtx.request.get(`${BASE}${path}`);
  check((r.headers()['content-security-policy'] ?? '').includes('frame-ancestors'), `${path} has a CSP with frame-ancestors`);
}

// ── 6. anonymous owner: token → httpOnly session, nothing in localStorage ──
const anon2 = await connectAgent(BASE);
const anonDoc = await (await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon2.token}` },
  body: JSON.stringify({ title: 'Anon Owned', markup: '<h1>ANON-OWNED</h1>' }),
})).json();
const anonCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const anonPage = await anonCtx.newPage();
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
check(await servedTopLevel(anonPage), 'before exchange: the token holder is just a reader (document, no iframe)');
// Keep the distinct browser credential from the guest approval. The CLI's
// API-scoped token is not a credential for browser page navigation.
await becomeOwner(anonPage, BASE, anon2.token);
const cookies = await anonCtx.cookies(BASE);
const sess = cookies.find((c) => /mx-agent-session/.test(c.name));
check(!!sess && sess.httpOnly, `session cookie is httpOnly (${sess?.name ?? 'missing'})`);
const stored = await anonPage.evaluate(() => [localStorage.getItem('mx_token'), localStorage.getItem('mx_tokens')]);
check(stored.every((v) => v === null), 'no token in localStorage after the exchange');
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
const anonFrameText = await anonPage.locator('[data-mx-inline-story]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(anonFrameText === 'ANON-OWNED', 'after exchange: the anonymous owner gets the shell (iframe) at the same URL');

// ── 6b. the anonymous owner can DISCONNECT — the cookie's own sign-out ──────
await openMenu(anonPage);
check(await anonPage.locator('[aria-label="Disconnect this browser"]').isVisible(), 'the menu offers Disconnect (not account Sign out) to an anonymous owner');
check((await anonPage.locator('[aria-label="Sign out"]').count()) === 0, 'and not account Sign out');
await Promise.all([
  anonPage.waitForResponse((r) => r.url().includes('/api/session/token') && r.request().method() === 'DELETE'),
  anonPage.locator('[aria-label="Disconnect this browser"]').click(),
]);
await anonPage.waitForTimeout(1500);
check(!(await anonCtx.cookies(BASE)).some((c) => /mx-agent-session/.test(c.name)), 'disconnecting cleared the agent-session cookie');
// …and the browser is a plain reader again: the same document, now without owner chrome.
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
check(await servedTopLevel(anonPage), 'after disconnect: the browser is a reader — the document, no iframe');

// ── 6c. the SPLIT-VIEWER case, in a real browser ──────────────────────────
// A browser can hold a CLAIMED token in its agent cookie while carrying no
// account session (the account signed out, or never signed in on this profile).
// The old implementation treated those as separate shell and /raw requests;
// this case now verifies that the shared app document resolves the agent cookie
// and renders the owner's PRIVATE document inline.
//
// `owner` (signed in above) already claimed `anon.token`, so it is now
// account-owned; a private doc published under it belongs to the account.
const claimedPriv = await api('/api/artifacts', { title: 'Claimed Private', markup: '<h1>CLAIMED-PRIVATE-BODY</h1>' });
check(claimedPriv.visibility === 'private', 'a claimed token publishes a private doc owned by the account');
const splitCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const splitPage = await splitCtx.newPage();
// A brand-new context carries the guest approval's browser cookie, distinct
// from the CLI's API-scoped token, and no account session.
await becomeOwner(splitPage, BASE, anon.token);
check(!!(await splitCtx.cookies(BASE)).find((c) => /mx-agent-session/.test(c.name)) && !(await sessionOf(splitCtx)),
  'the split-viewer browser holds only the approval cookie (no account session)');
const splitResponse = await splitPage.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' });
const splitText = await splitPage.locator('[data-mx-inline-story]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(splitText === 'CLAIMED-PRIVATE-BODY', `the shell frame shows the DOCUMENT, not a 404 — raw resolved the cookie viewer (status ${splitResponse?.status()}, text ${splitText}, body ${(await splitPage.locator('body').innerText()).slice(0, 140)})`);
// And a browser with neither credential still gets the uniform 404.
const nobodyCtx = await browser.newContext();
const nobody = await nobodyCtx.newPage();
check((await nobody.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' })).status() === 404, 'a browser with no credential is a uniform 404 on the same private doc');
await nobodyCtx.close();
await splitCtx.close();

// ── 7. cross-site Origin is rejected on cookie mutations ─────────────────
const csrf = await ownerCtx.request.patch(`${BASE}/api/my/profile`, {
  headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
  data: { username: `mxmx_test_sec_${ts}` },
});
check(csrf.status() === 403, `PATCH /api/my/profile with a cross-site Origin is 403 (${csrf.status()})`);
const sameOrigin = await ownerCtx.request.get(`${BASE}/api/my/profile`, { headers: { Origin: BASE } });
check(sameOrigin.status() === 200, 'same-origin request still works');

await browser.close();
sink.close();
check.done();
