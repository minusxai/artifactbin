/**
 * Gate: security architecture v2 — the browser/HTTP seams that no in-process
 * test can answer (see ~/projects/secure-arch-v2.md).
 *
 *   1. READER: /a/<id> answers a viewer with no session with the DOCUMENT
 *      ITSELF — top-level, no iframe, same URL — under the sandbox CSP; inside
 *      it the origin is opaque (no cookie, no storage, no fetch, no service
 *      worker) and the history prelude holds (replaceState cannot spoof the
 *      URL bar). A signed-in NON-owner gets the same document, no redirect.
 *   2. OWNER: the app page (page controls + `iframe[title="artifact"]`), and edit
 *      mode still mounts the canvas — whose document carries its own CSP.
 *   3. EXPORT still yields a PNG for a reader after the reader path changed.
 *   4. `/raw` is an internal address: absent from the docs.
 *   5. App pages carry a CSP with frame-ancestors.
 *   6. ANONYMOUS OWNER: a minted token is exchanged for an httpOnly session
 *      (POST /api/session/token); the browser then holds NO token in
 *      localStorage and /a/<id> shows the owner shell.
 *   7. Cookie-authenticated mutations reject a cross-site Origin.
 *
 * Runs against a dev server started with the mail sink:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *   node scripts/gate-secure-arch.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
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

const anon = await mintAnon(BASE);
const claimed = await owner.evaluate(async (t) => (await fetch('/api/tokens/claim', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }),
})).status, anon.token);
check(claimed === 200, 'owner A claimed a token');

const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// A public doc whose author script probes its own sandbox and writes the
// answers into the DOM (the ONLY channel out of an opaque document).
const PROBE = `<Helmet><title>Sec Probe</title><script>{\`
(function(){
  var out = {};
  function t(k, fn){ try { out[k] = String(fn()); } catch (e) { out[k] = 'THROW ' + e.name; } }
  t('origin', function(){ return window.origin; });
  t('isTop', function(){ return window.top === window; });
  t('cookie', function(){ return document.cookie; });
  t('storage', function(){ return localStorage.length; });
  t('sw', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); return 'attempted'; });
  var before = location.pathname;
  t('replaceState', function(){ history.replaceState(null, '', '/spoofed'); return location.pathname === before ? 'held' : 'SPOOFED ' + location.pathname; });
  fetch('/api/artifacts').then(function(r){ out.fetch = 'OK ' + r.status; render(); }, function(){ out.fetch = 'blocked'; render(); });
  // The ONE url the CSP admits is the document's own query endpoint; a
  // sibling route on the same path prefix is not it.
  var id = location.pathname.split('/')[2] || 'unknown';
  fetch('/a/' + id + '/query?q=%7B%7D').then(function(r){ out.ownQuery = 'OK ' + r.status; render(); }, function(){ out.ownQuery = 'blocked'; render(); });
  fetch('/a/' + id + '/start', { method: 'POST' }).then(function(r){ out.start = 'OK ' + r.status; render(); }, function(){ out.start = 'blocked'; render(); });
  function render(){ var el = document.getElementById('sec-probe'); if (el) el.textContent = JSON.stringify(out); }
  render();
})();
\`}</script></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">SEC-PROBE-DOC</h1><pre id="sec-probe">pending</pre></div>`;

const doc = await api('/api/artifacts', { title: 'Sec Probe', markup: PROBE, visibility: 'public' });
check(doc.visibility === 'public', 'probe doc is public');

// ── 1. reader: the document itself, top-level, sandboxed ──────────────────
const readerResp = await reader.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const readerCsp = readerResp.headers()['content-security-policy'] ?? '';
check(readerCsp.includes('sandbox') && readerCsp.includes("default-src 'none'"), `reader /a/<id> carries the sandbox CSP (${readerCsp.slice(0, 40)}…)`);
check(reader.url() === `${BASE}/a/${doc.id}`, `reader URL unchanged, no redirect (${new URL(reader.url()).pathname})`);
check((await reader.locator('iframe[title="artifact"]').count()) === 0, 'reader page has NO artifact iframe');
await reader.waitForFunction(() => { const t = document.getElementById('sec-probe')?.textContent ?? ''; return /"fetch"/.test(t) && /"ownQuery"/.test(t) && /"start"/.test(t); }, null, { timeout: 15000 }).catch(() => {});
const probe = JSON.parse(await reader.locator('#sec-probe').textContent().catch(() => '{}') || '{}');
check(probe.origin === 'null', `document origin is opaque (${probe.origin})`);
check(probe.isTop === 'true', 'document is the top-level browsing context');
check(/THROW/.test(probe.cookie ?? ''), `document.cookie throws (${probe.cookie})`);
check(/THROW/.test(probe.storage ?? ''), `localStorage throws (${probe.storage})`);
check(probe.fetch === 'blocked', `fetch to /api is blocked (${probe.fetch})`);
check(probe.ownQuery === 'OK 200', `fetch to the document's OWN query url is admitted (${probe.ownQuery}) — the one connect-src`);
check(probe.start === 'blocked', `fetch to /a/<id>/start is blocked (${probe.start}) — path-exact, not a prefix`);
check(probe.replaceState === 'held', `history prelude holds — replaceState cannot spoof the URL (${probe.replaceState})`);

// signed-in NON-owner: same document, same URL, no hop
const otherResp = await other.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check((otherResp.headers()['content-security-policy'] ?? '').includes('sandbox'), 'signed-in non-owner gets the sandboxed document');
check(other.url() === `${BASE}/a/${doc.id}`, 'signed-in non-owner: URL unchanged, no redirect');
check((await other.locator('iframe[title="artifact"]').count()) === 0, 'signed-in non-owner: no iframe');

// private: the ACL still runs first on every path — B and the reader get the uniform 404
const priv = await api('/api/artifacts', { title: 'Sec Private', markup: '<h1>SEC-PRIVATE</h1>' });
check(priv.visibility === 'private', 'owned doc is born private');
check((await other.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: signed-in non-owner is a uniform 404');
check((await reader.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' })).status() === 404, 'private: session-less reader is a uniform 404');
await owner.goto(`${BASE}/a/${priv.id}`, { waitUntil: 'load' });
check((await owner.frameLocator('iframe[title="artifact"]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null)) === 'SEC-PRIVATE', 'private: owner sees it in the shell');

// ── 2. owner: app shell + iframe; EDITING DOES NOT WEAKEN THE SANDBOX ──────
await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const ownerFrame = owner.frameLocator('iframe[title="artifact"]');
const ownerText = await ownerFrame.locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(ownerText === 'SEC-PROBE-DOC', 'owner sees the shell with the document in the sandboxed iframe');

/*
 * There is no edit canvas to carry a CSP of its own any more: editing happens
 * in the served document, which already has one from its response headers. So
 * what has to be true is stronger and simpler — entering edit mode changes
 * nothing about the sandbox. The document stays opaque to the page (that is
 * what `contentDocument === null` means from here), and the frame keeps every
 * sandbox flag it had.
 */
const sandboxBefore = await owner.evaluate(() =>
  document.querySelector('iframe[title="artifact"]')?.getAttribute('sandbox') ?? null);
await owner.click('[aria-label="Open artifact controls"]');
await owner.click('[aria-label="Edit artifact"]');
await owner.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
await owner.waitForTimeout(3000);
const editing = await owner.evaluate(() => {
  const f = document.querySelector('iframe[title="artifact"]');
  let reachable = false;
  try { reachable = !!f?.contentDocument; } catch { reachable = false; }
  return { sandbox: f?.getAttribute('sandbox') ?? null, reachable };
});
check(editing.sandbox === sandboxBefore && !!sandboxBefore,
  'entering edit mode keeps every sandbox flag the document had');
check(!editing.reachable,
  'and the document it edits is STILL opaque to the page (contentDocument null)');

// ── 3. export still works for a reader ────────────────────────────────────
const shot = await readerCtx.request.get(`${BASE}/a/${doc.id}/export`);
check(shot.status() === 200 && (shot.headers()['content-type'] ?? '').includes('image/png'), `reader export is a PNG (${shot.status()})`);

// ── 3b. a PRIVATE document exports the DOCUMENT, not its own 404 ──────────
// The page admits the exporter with a signed key, but the document arrives
// through a separate, credential-less request for /a/<id>/raw — so without the
// key riding down to the frame this succeeded and returned a 200 PNG of a
// not-found page. Same markup, published twice: if the private one is really
// the document, the two images are within a few percent of each other.
const SHOT_MARKUP = '<section className="p-16"><h1 className="text-6xl font-bold">EXPORT PROOF</h1><p className="mt-8 text-2xl">the body of the document</p></section>';
const shotPublic = await api('/api/artifacts', { title: 'Shot Public', markup: SHOT_MARKUP, visibility: 'public' });
const shotPrivate = await api('/api/artifacts', { title: 'Shot Private', markup: SHOT_MARKUP });
check(shotPrivate.visibility === 'private', 'the export-proof doc is private');
const [pubBytes, privBytes] = await Promise.all([
  owner.request.get(`${BASE}/a/${shotPublic.id}/export`).then((r) => r.body()),
  owner.request.get(`${BASE}/a/${shotPrivate.id}/export`).then((r) => r.body()),
]);
const ratio = Math.min(pubBytes.length, privBytes.length) / Math.max(pubBytes.length, privBytes.length);
check(ratio > 0.9, `a PRIVATE doc exports the same image its PUBLIC twin does (size ratio ${ratio.toFixed(2)}) — not a 404 page`);

// ── 4. /raw is internal ───────────────────────────────────────────────────
const llm = await (await fetch(`${BASE}/docs/artifactbin/references/publishing.md`)).text();
check(!llm.includes('/raw'), '/docs/artifactbin/references/publishing.md no longer teaches /raw');
const rawResp = await readerCtx.request.get(`${BASE}/a/${doc.id}/raw`);
check(rawResp.status() === 200, '/raw still answers (internal address for the iframe/embeds)');

// ── 5. app pages carry a CSP ──────────────────────────────────────────────
for (const path of ['/', '/tokens', '/login']) {
  const r = await readerCtx.request.get(`${BASE}${path}`);
  check((r.headers()['content-security-policy'] ?? '').includes('frame-ancestors'), `${path} has a CSP with frame-ancestors`);
}

// ── 6. anonymous owner: token → httpOnly session, nothing in localStorage ──
const anon2 = await mintAnon(BASE);
const anonDoc = await (await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon2.token}` },
  body: JSON.stringify({ title: 'Anon Owned', markup: '<h1>ANON-OWNED</h1>' }),
})).json();
const anonCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const anonPage = await anonCtx.newPage();
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
check((await anonPage.locator('iframe[title="artifact"]').count()) === 0, 'before exchange: the token holder is just a reader (document, no iframe)');
// The exchange has to run from an APP page: this tab is currently showing the
// document itself, which is opaque-origin and cannot fetch anything at all —
// that it cannot is the sandbox working, and is asserted above.
await anonPage.goto(`${BASE}/`, { waitUntil: 'load' });
const exchange = await anonPage.evaluate(async (t) => (await fetch('/api/session/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }),
})).status, anon2.token);
check(exchange === 204, `POST /api/session/token exchanged the token for a session (${exchange})`);
const cookies = await anonCtx.cookies(BASE);
const sess = cookies.find((c) => /mx-agent-session/.test(c.name));
check(!!sess && sess.httpOnly, `session cookie is httpOnly (${sess?.name ?? 'missing'})`);
const stored = await anonPage.evaluate(() => [localStorage.getItem('mx_token'), localStorage.getItem('mx_tokens')]);
check(stored.every((v) => v === null), 'no token in localStorage after the exchange');
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
const anonFrameText = await anonPage.frameLocator('iframe[title="artifact"]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(anonFrameText === 'ANON-OWNED', 'after exchange: the anonymous owner gets the shell (iframe) at the same URL');

// ── 6b. the anonymous owner can DISCONNECT — the cookie's own sign-out ──────
await anonPage.click('[aria-label="Open menu"]');
check(await anonPage.locator('[aria-label="Disconnect this browser"]').isVisible(), 'the menu offers Disconnect (not account Sign out) to an anonymous owner');
check((await anonPage.locator('[aria-label="Sign out"]').count()) === 0, 'and not account Sign out');
await Promise.all([
  anonPage.waitForResponse((r) => r.url().includes('/api/session/token') && r.request().method() === 'DELETE'),
  anonPage.locator('[aria-label="Disconnect this browser"]').click(),
]);
await anonPage.waitForTimeout(1500);
check(!(await anonCtx.cookies(BASE)).some((c) => /mx-agent-session/.test(c.name)), 'disconnecting cleared the agent-session cookie');
// …and the browser is a plain reader again: the same document, now with no shell.
await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
check((await anonPage.locator('iframe[title="artifact"]').count()) === 0, 'after disconnect: the browser is a reader — the document, no iframe');

// ── 6c. the SPLIT-VIEWER case, in a real browser ──────────────────────────
// A browser can hold a CLAIMED token in its cookie while carrying no NextAuth
// session (the account signed out, or never signed in on this profile). It IS
// an owner — the cookie resolves to the account — so the proxy hands it the
// shell. But the document arrives through a SEPARATE request for /a/<id>/raw,
// and while that route resolved the viewer NextAuth-only it saw no session and
// 404'd: the shell rendered around a not-found frame, for the owner's OWN
// PRIVATE document. This drives exactly that browser.
//
// `owner` (signed in above) already claimed `anon.token`, so it is now
// account-owned; a private doc published under it belongs to the account.
const claimedPriv = await api('/api/artifacts', { title: 'Claimed Private', markup: '<h1>CLAIMED-PRIVATE-BODY</h1>' });
check(claimedPriv.visibility === 'private', 'a claimed token publishes a private doc owned by the account');
const splitCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const splitPage = await splitCtx.newPage();
// A brand-new context: it has NO NextAuth session. It exchanges the claimed
// token for the agent cookie, and nothing else.
await splitPage.goto(`${BASE}/`, { waitUntil: 'load' });
const splitExchange = await splitPage.evaluate(async (t) => (await fetch('/api/session/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }),
})).status, anon.token);
check(splitExchange === 204, 'the split-viewer browser holds only the agent cookie (no NextAuth session)');
await splitPage.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' });
const splitText = await splitPage.frameLocator('iframe[title="artifact"]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(splitText === 'CLAIMED-PRIVATE-BODY', 'the shell frame shows the DOCUMENT, not a 404 — raw resolved the cookie viewer');
// And a browser with neither credential still gets the uniform 404.
const nobodyCtx = await browser.newContext();
const nobody = await nobodyCtx.newPage();
check((await nobody.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' })).status() === 404, 'a browser with no credential is a uniform 404 on the same private doc');
await nobodyCtx.close();
await splitCtx.close();

// ── 6d. a HOSTILE artifact cannot touch the reader who opens it ────────────
// The real question: a logged-in user opens SOMEONE ELSE's malicious document.
// Its script now runs top-level in that user's tab, with the user's session
// cookie riding the navigation that fetched it. Prove the script can neither
// READ the victim's credential nor ACT as them — both the mechanism (opaque
// origin + CSP) and the outcome (no state change on the victim's account).
//
// `owner` is signed in and owns real artifacts (it claimed anon.token above);
// `other` is a different account. `other` publishes the hostile doc, `owner`
// is its reader.
const HOSTILE = `<Helmet><title>Hostile</title><script>{\`
(function(){
  var out = {};
  function render(){ var el = document.getElementById('h'); if (el) el.textContent = JSON.stringify(out); }
  out.cookie = (function(){ try { return document.cookie === '' ? 'empty' : 'READABLE:' + document.cookie; } catch (e) { return 'throw:' + e.name; } })();
  out.storage = (function(){ try { return String(localStorage.length); } catch (e) { return 'throw:' + e.name; } })();
  function probe(k, p){ p.then(function(r){ out[k] = 'HTTP ' + r.status; render(); }, function(e){ out[k] = 'blocked:' + e.name; render(); }); }
  probe('list', fetch('/api/my/artifacts', { credentials: 'include' }));
  probe('steal', fetch('/api/my/artifacts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'PWNED-BY-HOSTILE', markup: '<h1>pwned</h1>' }) }));
  // A form is the classic CSP-bypass for connect-src; form-action 'none' must stop it.
  try {
    var f = document.createElement('form'); f.method = 'POST'; f.action = '/api/my/artifacts';
    var i = document.createElement('input'); i.name = 'title'; i.value = 'PWNED-BY-FORM'; f.appendChild(i);
    document.body.appendChild(f); f.submit(); out.form = 'submitted';
  } catch (e) { out.form = 'throw:' + e.name; }
  render();
})();
\`}</script></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">HOSTILE-DOC</h1><pre id="h">pending</pre></div>`;
const hostile = await (await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await mintAnon(BASE)).token}` },
  body: JSON.stringify({ title: 'Hostile', markup: HOSTILE, visibility: 'public' }),
})).json();
check(!!hostile.id, 'a hostile PUBLIC artifact is published by another party');

// Victim's artifact list BEFORE (through their own signed-in page).
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
const listBefore = await owner.evaluate(async () => (await (await fetch('/api/my/artifacts')).json()).artifacts.length);

// Victim opens the hostile document. Its script runs; give it a moment.
await owner.goto(`${BASE}/a/${hostile.id}`, { waitUntil: 'load' });
await owner.waitForFunction(() => /"steal"/.test(document.getElementById('h')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const attack = JSON.parse(await owner.locator('#h').textContent().catch(() => '{}') || '{}');
check(attack.cookie === 'empty' || /throw/.test(attack.cookie ?? ''), `hostile script cannot read the victim's session cookie (${attack.cookie})`);
check(/throw/.test(attack.storage ?? ''), `nor their localStorage (${attack.storage})`);
check(/^blocked/.test(attack.list ?? ''), `it cannot LIST the victim's artifacts (${attack.list})`);
check(/^blocked/.test(attack.steal ?? ''), `nor create one as them (${attack.steal})`);

// The OUTCOME, server-side: nothing was created on the victim's account.
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
const after = await owner.evaluate(async () => (await (await fetch('/api/my/artifacts')).json()).artifacts);
check(after.length === listBefore, `the victim's artifact count is unchanged (${listBefore} → ${after.length})`);
check(!after.some((a) => /PWNED/.test(a.title ?? '')), 'and no artifact was forged on their account (fetch AND form both dead)');

// ── 6e. the reader gets the document TOP-LEVEL, and it can load nothing remote ─
// Two things at once: a non-owner's page is the document ITSELF (no iframe,
// window.top === window), and the CSP that document ships lets it fetch NOTHING
// off-origin — remote script, image, font, or connect are all refused. The
// browser's own CSP-violation console messages are the deterministic signal
// (they fire whether or not the test host has internet).
// LAYER 1 — no SERVED document ever fetches from a remote host. Two different
// mechanisms reach that one property, and both are checked here:
//   • an <img src> is IMPORTED at publish (lib/web-assets) and the URL is KEPT
//     in the stored document — what changes is the SERVED copy, which is
//     pointed at /assets/<hash> on this origin. That, not the stored bytes, is
//     the property that matters; the network-level proof is in gate-web-import.
//   • every OTHER external subresource position is still refused outright.
const declImg = await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
  body: JSON.stringify({ title: 'Decl remote', markup: '<div><img src="https://picsum.photos/20/20" /></div>' }),
});
const declBody = await declImg.json().catch(() => ({}));
if (declImg.status === 201) {
  const declStored = (await (await fetch(`${BASE}/api/artifacts/${declBody.id}`, {
    headers: { Authorization: `Bearer ${anon.token}` },
  })).json()).markup ?? '';
  check(declStored.includes('picsum.photos'), 'the URL an author wrote is KEPT in the stored document');
  // With the credential: this token is CLAIMED, so its documents are born
  // private and a session-less read of one is the uniform 404 by design.
  const declServed = await (await fetch(`${BASE}/a/${declBody.id}/raw`, {
    headers: { Authorization: `Bearer ${anon.token}` },
  })).text();
  // The mapped address carries a content-derived `?v=` when the row is known
  // (lib/story/asset-url, R19) — the version is a cache key, so what this leg
  // is about is the ADDRESS being ours.
  const mapped = /src="\/assets\/[0-9a-f]{64}(\?v=[0-9a-f]{8})?"/.test(declServed);
  // A host this machine cannot reach is a WARNING rather than a refusal, and
  // the unmapped URL is then refused by the document's own CSP (layer 2 below)
  // — so the gate needs no internet to mean something.
  const warned = Array.isArray(declBody.warnings) && declBody.warnings.some((w) => String(w.url).includes('picsum.photos'));
  check(mapped || warned, mapped
    ? 'and the SERVED document is pointed at our copy on this origin'
    : 'and an import this host could not reach was reported as a warning, never a refusal');
} else {
  // No outbound access from this host: the import cannot complete, and the
  // publish fails closed — which is equally acceptable for this gate.
  check(declImg.status === 400, `an unreachable import fails the publish closed (${declImg.status})`);
}
const declOther = await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
  body: JSON.stringify({ title: 'Decl remote 2', markup: '<div><img srcSet="https://picsum.photos/20/20 1x" /></div>' }),
});
check(declOther.status === 400, `a non-image-position remote URL is still rejected AT PUBLISH (${declOther.status})`);
check(/self-contained|External URL/i.test(JSON.stringify(await declOther.json())), 'and says the document must be self-contained');

// LAYER 2 — runtime-injected remote loads (author JS, which the publisher
// cannot see) are refused by the served document's CSP.
const REMOTE = `<Helmet><title>Remote probe</title><script>{\`
(function(){
  var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/left-pad/index.js'; document.head.appendChild(s);
  var i = new Image(); i.src = 'https://picsum.photos/10/10';
  fetch('https://example.com/').catch(function(){});
  var st = document.createElement('link'); st.rel = 'stylesheet'; st.href = 'https://fonts.googleapis.com/css?family=Roboto'; document.head.appendChild(st);
})();
\`}</script></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">REMOTE-PROBE</h1></div>`;
const remoteDoc = await api('/api/artifacts', { title: 'Remote probe', markup: REMOTE, visibility: 'public' });

const csp = [];
const rdrCtx = await browser.newContext();
const rdr = await rdrCtx.newPage();
rdr.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to (load|connect)/i.test(t)) csp.push(t); });
await rdr.goto(`${BASE}/a/${remoteDoc.id}`, { waitUntil: 'load' });
await rdr.waitForTimeout(2500);

// Top-level, not framed.
check((await rdr.locator('iframe[title="artifact"]').count()) === 0, 'reader: the document is the page, not an iframe');
check(await rdr.evaluate(() => window.top === window) === true, 'reader: window.top === window (it IS the top-level document)');

// Every remote resource was refused by the CSP.
const refused = (re) => csp.some((t) => re.test(t));
check(refused(/script/i), 'a remote <script src> is refused (script-src self)');
check(refused(/img|image/i), 'a remote <img> is refused (img-src self)');
check(refused(/stylesheet|style-src/i) || refused(/font|googleapis/i), 'a remote stylesheet/font is refused');
check(refused(/connect|example\.com|fetch/i), 'a remote fetch/connect is refused (no connect-src)');
await rdrCtx.close();

// ── 6f. a browser that predates the cookie is carried across ──────────────
// The migration case: this browser holds its token the OLD way (localStorage)
// and nothing reads it any more. Opening the app must exchange it for the
// cookie once, delete it, and leave the browser owning its documents again.
const legacy = await mintAnon(BASE);
const legacyDoc = await (await fetch(`${BASE}/api/artifacts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${legacy.token}` },
  body: JSON.stringify({ title: 'Legacy Owned', markup: '<h1>LEGACY-OWNED</h1>' }),
})).json();
const oldCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const oldPage = await oldCtx.newPage();
// Seed the pre-cookie shape before any app script runs.
await oldPage.addInitScript((t) => {
  localStorage.setItem('mx_token', t);
  localStorage.setItem('mx_tokens', JSON.stringify([t]));
}, legacy.token);
await oldPage.goto(`${BASE}/a/${legacyDoc.id}`, { waitUntil: 'load' });
check((await oldPage.locator('iframe[title="artifact"]').count()) === 0, 'migration: a localStorage token alone does NOT authorize — it is a reader');
// Landing anywhere in the app runs the bridge.
await oldPage.goto(`${BASE}/`, { waitUntil: 'load' });
await oldPage.waitForFunction(() => !localStorage.getItem('mx_token') && !localStorage.getItem('mx_tokens'), null, { timeout: 15000 }).catch(() => {});
check(await oldPage.evaluate(() => !localStorage.getItem('mx_token') && !localStorage.getItem('mx_tokens')), 'migration: the leftover token is exchanged and DELETED');
check((await oldCtx.cookies(BASE)).some((c) => /mx-agent-session/.test(c.name) && c.httpOnly), 'migration: the browser now holds the httpOnly cookie instead');
await oldPage.goto(`${BASE}/a/${legacyDoc.id}`, { waitUntil: 'load' });
const migratedText = await oldPage.frameLocator('iframe[title="artifact"]').locator('h1').first().textContent({ timeout: 20000 }).catch(() => null);
check(migratedText === 'LEGACY-OWNED', 'migration: and owns its document again — the shell, at the same URL');
await oldCtx.close();

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
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
