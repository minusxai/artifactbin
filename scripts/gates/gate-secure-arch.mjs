/**
 * Gate: the security architecture — the browser and HTTP seams that no
 * in-process test can answer.
 *
 *   1. READER: /a/<id> answers a viewer with no session with the app page,
 *      under the strict app CSP, framing the document on its own origin
 *      (`<hex id>.<pages host>`), and the document's runtime reaches its scoped
 *      query door. A signed-in NON-owner gets the same page, no redirect.
 *   2. OWNER: the app page (page controls + the framed document).
 *   3. EXPORT still yields a PNG for a reader after the reader path changed.
 *   4. `/raw` is an internal address: absent from the docs.
 *   5. App pages carry a CSP with frame-ancestors.
 *   6. ANONYMOUS OWNER: a minted token is exchanged for an httpOnly agent
 *      session (POST /api/session/token); the browser then holds NO token in
 *      localStorage and /a/<id> shows owner chrome around the framed document.
 *   7. Cookie-authenticated mutations reject a cross-site Origin.
 *
 * The author script runs in the document itself (lib/islands/page-runtime);
 * there is no author frame or managed Iframe. This gate asks only who is
 * served what.
 *
 * Runs against a dev server started with the mail sink:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *   node scripts/gates/gate-secure-arch.mjs [base]
 */
import { becomeOwner, mergeGuestIntoAccount } from '../lib/start-doc.mjs';
import { documentFrame, documentLocator } from './lib/page-facts.mjs';
import { PAGES_HOST } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openMenu } from './lib/reveal-chrome.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('secure-arch');
const ts = Date.now().toString(36);

const sink = await startMailSink();
const browser = await launchChromium();

// ── owner session A, stranger session B ───────────────────────────────────
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
await loginViaEmail(owner, BASE, sink, `mxmx_test_sec_a_${ts}@example.com`);
const otherCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const other = await otherCtx.newPage();
await loginViaEmail(other, BASE, sink, `mxmx_test_sec_b_${ts}@example.com`);
const readerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const reader = await readerCtx.newPage();
/*
 * Every reader gets the app page framing the document on the document's own origin (lib/serving/document-frame);
 * this replaces the old "served top-level, no artifact iframe" delivery promise.
 */
const framedOnItsOrigin = async (page, id) => {
  const doc = await documentFrame(page).catch(() => null);
  return !!doc && doc !== page.mainFrame()
    && new URL(doc.url()).hostname === `${Buffer.from(id, 'utf8').toString('hex')}.${PAGES_HOST}`;
};
/** The owner's bar carries Share; a reader's does not. */
const ownerBar = async (page) => {
  await page.locator('[aria-label="Open artifact controls"]').waitFor({ timeout: 20000 }).catch(() => {});
  return (await page.locator('header[aria-label="Page bar"] [aria-label="Share"]').count()) === 1;
};
const docHeading = (page) => documentLocator(page).locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
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

const PROBE = `<Helmet><title>Sec Probe</title><Value name="probe" type="string" default="{}"/></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">SEC-PROBE-DOC</h1><pre id="sec-probe">{$probe}</pre></div>`;

const doc = await api('/api/artifacts', { title: 'Sec Probe', markup: PROBE, visibility: 'public' });
check(doc.visibility === 'public', 'probe doc is public');

// ── 1. reader: the app page, framing the document on its own origin ───────
const readerResp = await reader.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const readerPath = new URL(reader.url()).pathname;
const readerCsp = readerResp.headers()['content-security-policy'] ?? '';
check(!readerCsp.includes('sandbox') && /script-src[^;]*'self'/.test(readerCsp) && !/script-src[^;]*'unsafe-eval'/.test(readerCsp), `reader carries the strict app CSP (${readerCsp.slice(0, 80)}…)`);
check(readerPath.includes(doc.id) && new URL(reader.url()).origin === BASE, `reader reaches its canonical artifact address (${readerPath})`);
check(await framedOnItsOrigin(reader, doc.id), 'reader page frames the document on its own origin (no artifact iframe)');
// The document's runtime runs in the frame, on its own origin: that is where its door is asked.
const readerDoc = await documentFrame(reader);
const parentQuery = await readerDoc.evaluate(async id => (await fetch('/a/' + id + '/query?q=%7B%7D')).status, doc.id).catch((e) => String(e));
check(parentQuery === 200, `trusted document runtime can fetch its scoped query (${parentQuery})`);

// signed-in NON-owner: same document, same URL, no hop
const otherResp = await other.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check(!(otherResp.headers()['content-security-policy'] ?? '').includes('sandbox'), 'signed-in non-owner gets the same top-level app policy');
check(new URL(other.url()).pathname === readerPath && new URL(other.url()).origin === BASE, 'signed-in non-owner reaches the same canonical address');
check(await framedOnItsOrigin(other, doc.id) && !(await ownerBar(other)), 'signed-in non-owner: the same framed document, no owner bar');

// private: the ACL still runs first on every path — B and the reader get the uniform 404
const priv = await api('/api/artifacts', { title: 'Sec Private', markup: '<h1>SEC-PRIVATE</h1>' });
check(priv.visibility === 'private', 'owned doc is born private');
check((await other.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: signed-in non-owner is a uniform 404');
check((await reader.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: session-less reader is a uniform 404');
await owner.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' });
check((await docHeading(owner)) === 'SEC-PRIVATE', 'private: owner sees it in the shell');

// ── 2. owner: app shell + the framed document ──────
await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const ownerText = await docHeading(owner);
check(ownerText === 'SEC-PROBE-DOC' && await ownerBar(owner), 'owner sees the shell with the document in its frame');

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
check(await framedOnItsOrigin(anonPage, anonDoc.id) && !(await ownerBar(anonPage)), 'before exchange: the token holder is just a reader (the framed document, no owner bar)');
// Keep the distinct browser credential from the guest approval. The CLI's
// API-scoped token is not a credential for browser page navigation.
await becomeOwner(anonPage, BASE, anon2.token);
const cookies = await anonCtx.cookies(BASE);
const sess = cookies.find((c) => /mx-agent-session/.test(c.name));
check(!!sess && sess.httpOnly, `session cookie is httpOnly (${sess?.name ?? 'missing'})`);
const stored = await anonPage.evaluate(() => [localStorage.getItem('mx_token'), localStorage.getItem('mx_tokens')]);
check(stored.every((v) => v === null), 'no token in localStorage after the exchange');
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
const anonFrameText = await docHeading(anonPage);
check(anonFrameText === 'ANON-OWNED' && await ownerBar(anonPage), 'after exchange: the anonymous owner gets the shell (owner bar, the framed document) at the same URL');

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
check(await framedOnItsOrigin(anonPage, anonDoc.id) && !(await ownerBar(anonPage)), 'after disconnect: the browser is a reader — the framed document, no owner bar');

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
const splitText = await docHeading(splitPage);
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
