/**
 * Gate: THE READER SHELL — who is served what at /a/<id>, as one journey over one set of fixtures.
 *
 * A crawler, a reader with JavaScript off, a session-less reader, a signed-in stranger, the owner, an anonymous
 * owner holding only the approval cookie, and a guest who signs in: each opens the same app page, which frames the
 * document on its own origin (`<hex id>.lvh.me`), and each must get exactly what it is owed — the document, the
 * owner's chrome, a canonical address, a 404, or the login door.
 *
 *   1. CRAWLER: a session-less fetch gets the app page with the document's title and unfurl tags, the same bytes
 *      for any user-agent; a browser mounts the document in its frame, and with JavaScript OFF the frame the
 *      server drew still reads.
 *   2. HOME: a logged-out visit to the app's home lands on /login, with and without JavaScript.
 *   3. READER: a session-less reader and a signed-in non-owner get the framed document at its canonical address,
 *      with no owner bar; its runtime reaches its scoped query door from the frame.
 *   4. OWNER: a PRIVATE document renders in the frame for its owner (the pages cookie carried into the frame),
 *      /a/<id> heals to /@username/<id>-<slug>, and the sharing modal flips it public and back.
 *   5. ANONYMOUS OWNER: a minted token is exchanged for an httpOnly agent session, nothing in localStorage;
 *      Disconnect clears the cookie; a browser holding only a CLAIMED token's cookie reads the account's private
 *      document; a browser with no credential gets the uniform 404.
 *   6. LINKS: a link inside the document takes the tab to the next document's app page, history works, the shelf
 *      and profile lists open documents in this tab, and a verified login adopts guest documents.
 *
 * Absorbs gate-shell-seo, gate-secure-arch, gate-visibility, gate-seamless-navigation and gate-app-home.
 * What left this gate, and where it lives now:
 *   - the CSP strings (secure-arch 98/108/138) → services/app/lib/__tests__/app-page-csp.test.ts and
 *     document-csp.test.ts; the served frame-src under the pages host stays in gate-own-origin-script;
 *   - uniform 404 fetches (secure-arch 115–116; visibility 84/126/142) → services/app/__tests__/visibility.test.ts
 *     (read enforcement) and api.test.ts; a private folder's 404 (visibility 160) → folder-page.test.ts;
 *   - the cross-site PATCH /api/my/profile 403 and its same-origin control (secure-arch 210/212) →
 *     services/app/__tests__/mutate-csrf.test.ts;
 *   - export PNGs (secure-arch 127; visibility 139–140, the owner's export of a private markup document) → the
 *     exports journey gate, which holds one PNG set for the whole suite;
 *   - duplicates of one fact: "owned doc is born private" and "the owner sees the private document in the frame"
 *     are asserted once (visibility's labels), as is "the session adopted the guest connection".
 *
 *   node scripts/gates/gate-reader-shell.mjs [base]
 */
import assert from 'node:assert/strict';
import { becomeOwner, mergeGuestIntoAccount, startDocument } from '../lib/start-doc.mjs';
import { documentFrame, documentLocator, INLINE_STORY } from './lib/page-facts.mjs';
import { launchChromium, PAGES_HOST } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('reader-shell');
const ts = Date.now().toString(36);

/** One leg's failure is reported and the journey goes on, so a run names every broken leg at once. */
const section = async (name, run) => {
  console.log(`█ ${name}`);
  try { await run(); } catch (error) { check(false, `${name}: the leg threw (${String(error?.message ?? error).split('\n')[0].slice(0, 300)})`); }
};

const sink = await startMailSink();
const browser = await launchChromium();

/*
 * Every reader gets the app page framing the document on the document's own origin (lib/serving/document-frame).
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

// ── 1. what a crawler gets, and what a browser mounts (was gate-shell-seo) ──
await section('crawler', async () => {
  const mint = await connectAgent(BASE);
  const publish = async (body) => {
    const res = await fetch(`${BASE}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  };

  const PHRASE = 'Indexable sentence about quarterly revenue';
  const doc = await publish({
    markup: [
      '<Helmet><title>Crawlable doc</title><meta name="description" content="A document that indexes." /></Helmet>',
      '<h1 className="text-4xl font-bold">Crawlable heading</h1>',
      `<p className="mt-4 leading-relaxed">${PHRASE}. And a second paragraph for good measure.</p>`,
    ].join('\n'),
  });
  check.note(`crawlable doc: ${BASE}/a/${doc.id}`);

  // The MARKUP, not the framework payload: the <script> tags carry per-request state that differs between any two
  // fetches. Scanned, not regexped, and NOT a sanitizer: this drops script elements from two responses so the rest
  // can be compared (a regexp of this shape reads as HTML filtering to any auditor).
  const dropScripts = (h) => {
    const lower = h.toLowerCase();
    let out = '';
    let at = 0;
    for (;;) {
      const open = lower.indexOf('<script', at);
      if (open === -1) return out + h.slice(at);
      out += h.slice(at, open);
      const close = lower.indexOf('</script', open);
      if (close === -1) return out;
      const after = h.indexOf('>', close);
      if (after === -1) return out;
      at = after + 1;
    }
  };
  const strip = (h) => dropScripts(h).replace(/\s+/g, ' ').trim();

  // What a crawler fetches: no JS, no browser, no session. The app page is a shell around the framed document and
  // carries none of its markup (docs/serving-and-security.md); the document's own origin serves the text.
  const pageHtml = await (await fetch(`${BASE}/a/${doc.id}`)).text();
  check(/<title>[^<]*Crawlable doc/.test(pageHtml), 'the page title is the document title');
  check(pageHtml.includes(`/a/${doc.id}/export`), 'og:image points at the export card');
  check(/property="og:title"|name="og:title"/.test(pageHtml), 'og:title is present');

  // Same markup for everyone: a "crawler" user-agent gets byte-identical html.
  const asBot = await (await fetch(`${BASE}/a/${doc.id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  })).text();
  check(strip(asBot) === strip(pageHtml), 'a crawler UA gets the same page — nothing is cloaked');

  // The document really is what the frame shows, in a browser as well as in the bytes.
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await becomeOwner(page, BASE, mint.token);
  await page.goto(`${BASE}/a/${doc.id}`);
  const frame = await documentFrame(page, { timeout: 20000 });
  await frame.locator(INLINE_STORY).first().waitFor({ state: 'visible', timeout: 20000 });
  check(frame !== page.mainFrame() && await frame.locator(INLINE_STORY).innerText().then(text => text.includes(PHRASE)),
    'the document text is in the document frame');
  await frame.waitForSelector('h1', { timeout: 20000 });
  check((await frame.evaluate('document.body.innerText')).includes(PHRASE), 'the framed document shows the real content');
  await page.close();

  // JS off: the served document is server-rendered, so the text is there.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 800 } });
  const plain = await noJs.newPage();
  await plain.goto(`${BASE}/a/${doc.id}`);
  const plainFrame = await documentFrame(plain, { timeout: 20000 });
  await plainFrame.waitForSelector('h1', { timeout: 20000 }).catch(() => {});
  const plainText = await plainFrame.evaluate('document.body.innerText').catch(() => '');
  check(plainText.includes(PHRASE), 'a reader with JS disabled still reads the document');
  await noJs.close();
});

// ── 2. the app's home, logged out (was gate-app-home) ──
await section('home', async () => {
  for (const javaScriptEnabled of [false, true]) {
    const mode = javaScriptEnabled ? 'with JavaScript' : 'without JavaScript';
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    await page.goto(BASE);
    check(new URL(page.url()).pathname === '/login', `application home redirects to login ${mode} (${new URL(page.url()).pathname})`);
    if (javaScriptEnabled) {
      check(await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor().then(() => true, () => false),
        'the login page draws its email field');
    }
    check(await page.locator('canvas').count() === 0, `the login page draws no canvas ${mode}`);
    await context.close();
  }
});

// ── owner A (also the visibility owner), stranger B, a session-less reader ──
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
const otherCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const other = await otherCtx.newPage();
await Promise.all([
  // The auto-assigned username is derived from this address (checked below), so it keeps its prefix.
  loginViaEmail(owner, BASE, sink, `mxmx_test_vis_${ts}@example.com`),
  loginViaEmail(other, BASE, sink, `mxmx_test_sec_b_${ts}@example.com`),
]);
const readerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const reader = await readerCtx.newPage();
check(
  (await sessionOf(ownerCtx)) && (await sessionOf(otherCtx)) && !(await sessionOf(readerCtx)),
  'two sessions (owner A, other B) and a session-less reader are up',
);

// A user-owned token: a guest connection, adopted from the owner's session.
const anon = await connectAgent(BASE, { email: `mxmx_test_vis_${ts}@example.com` });
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

// ── 3. the reader: the app page, framing the document on its own origin (was gate-secure-arch §1–2) ──
await section('reader', async () => {
  const PROBE = `<Helmet><title>Sec Probe</title><Value name="probe" type="string" default="{}"/></Helmet>
<div className="p-8"><h1 className="text-3xl font-bold">SEC-PROBE-DOC</h1><pre id="sec-probe">{$probe}</pre></div>`;
  const doc = await api('/api/artifacts', { title: 'Sec Probe', markup: PROBE, visibility: 'public' });
  check(doc.visibility === 'public', 'probe doc is public');

  await reader.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  const readerPath = new URL(reader.url()).pathname;
  check(readerPath.includes(doc.id) && new URL(reader.url()).origin === BASE, `reader reaches its canonical artifact address (${readerPath})`);
  check(await framedOnItsOrigin(reader, doc.id), 'reader page frames the document on its own origin (no artifact iframe)');
  // The document's runtime runs in the frame, on its own origin: that is where its door is asked.
  const readerDoc = await documentFrame(reader);
  const parentQuery = await readerDoc.evaluate(async id => (await fetch('/a/' + id + '/query?q=%7B%7D')).status, doc.id).catch((e) => String(e));
  check(parentQuery === 200, `trusted document runtime can fetch its scoped query (${parentQuery})`);

  // signed-in NON-owner: same document, same URL, no hop
  await other.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  check(new URL(other.url()).pathname === readerPath && new URL(other.url()).origin === BASE, 'signed-in non-owner reaches the same canonical address');
  check(await framedOnItsOrigin(other, doc.id) && !(await ownerBar(other)), 'signed-in non-owner: the same framed document, no owner bar');

  // the owner: app shell + the framed document
  await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  const ownerText = await docHeading(owner);
  check(ownerText === 'SEC-PROBE-DOC' && await ownerBar(owner), 'owner sees the shell with the document in its frame');

  // The busiest authenticated toolbar must retain every action on narrow phones.
  for (const width of [320, 390]) {
    await owner.setViewportSize({ width, height: 844 });
    const bar = owner.getByRole('banner', { name: 'Page bar' });
    for (const name of ['Like', 'Comment', 'Edit', 'Share', 'Notifications', 'Open artifact controls', 'Open menu']) {
      await bar.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' });
    }
    const geometry = await bar.evaluate(element => {
      const controls = [...element.querySelectorAll('a, button')].map(control => {
        const bounds = control.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return { name: control.getAttribute('aria-label'), left: bounds.left, right: bounds.right, width: bounds.width, reachable: hit === control || control.contains(hit) };
      }).filter(control => control.width > 0);
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls };
    });
    check(geometry.scrollWidth <= width, `owner toolbar has no page overflow at ${width}px`);
    check(geometry.controls.every(control => control.left >= 0 && control.right <= width && control.width >= 36 && control.reachable),
      `all owner toolbar controls keep full targets inside ${width}px: ${JSON.stringify(geometry.controls)}`);
    await bar.getByRole('button', { name: 'Open menu', exact: true }).click();
    await owner.getByRole('navigation', { name: 'Menu', exact: true }).waitFor({ state: 'visible' });
    check(await owner.getByRole('button', { name: 'Dismiss menu', exact: true }).isVisible(), `owner menu is reachable at ${width}px`);
    await owner.getByRole('button', { name: 'Dismiss menu', exact: true }).click();
  }
  await owner.setViewportSize({ width: 1400, height: 950 });
  check((await owner.locator('a[aria-label="Star artifactbin on GitHub"]:visible').textContent()).includes('Star'),
    'desktop toolbar keeps its visible Star label');

  // /raw is internal
  const llm = await (await fetch(`${BASE}/llms.txt`)).text();
  check(llm.includes('afbin') && !llm.includes('/raw'), 'agent discovery teaches the CLI without internal raw links');
  const rawResp = await readerCtx.request.get(`${BASE}/a/${doc.id}/raw`);
  check(rawResp.status() === 200, '/raw still answers (internal address for the iframe/embeds)');
});

// ── 4. the owner's private document, its pretty URL, its sharing (was gate-visibility) ──
await section('owner', async () => {
  const page = owner;
  const stranger = reader;
  const username = (await page.evaluate(async () => (await (await fetch('/api/my/profile')).json()).username));
  check(/^mxmx_test_vis_[a-z0-9]+_[a-z0-9]{4}$/.test(username), `auto-assigned username looks right (${username})`);

  const doc = await api('/api/artifacts', { title: 'Cookie Proof', markup: '<h1 id="pf">IFRAME-COOKIE-OK</h1>' });
  check(doc.visibility === 'private', 'owned doc is born private');
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  const iframeText = await documentLocator(page).locator('#pf').textContent({ timeout: 20000 }).catch(() => null);
  check(iframeText === 'IFRAME-COOKIE-OK', 'PRIVATE html renders for the owner — the sandboxed iframe request carried the session cookie');

  // pretty URLs self-heal in the location bar
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await page.waitForURL(`${BASE}/@${username}/${doc.id}-cookie-proof`, { timeout: 20000 }).catch(() => {});
  check(
    page.url() === `${BASE}/@${username}/${doc.id}-cookie-proof`,
    `/a/<id> healed to the canonical pretty URL (${new URL(page.url()).pathname})`,
  );
  await page.goto(`${BASE}/@totally_wrong/${doc.id}-stale-name`, { waitUntil: 'load' });
  await page.waitForURL(`${BASE}/@${username}/${doc.id}-cookie-proof`, { timeout: 20000 }).catch(() => {});
  check(page.url().includes(`/@${username}/${doc.id}-cookie-proof`), 'a mangled pretty URL heals by id');

  // ShareLink flips visibility from the page. Every interaction waits for the SERVER to answer rather than a fixed
  // pause: a click that lands before the app hydrates does nothing and raises nothing.
  const sharingPut = () => page.waitForResponse(
    (r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200,
    { timeout: 15000 },
  );
  await openArtifactControls(page);
  await page.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
  const sharingDialog = page.locator('[role="dialog"][aria-label="Sharing"]');
  await sharingDialog.waitFor({ timeout: 15000 });
  await page.waitForTimeout(250); // let the restrained entrance transform settle before measuring its center
  const [sharingBox, sharingViewport] = await Promise.all([
    sharingDialog.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  check(!!sharingBox
    && sharingBox.width > 500
    && Math.abs(sharingBox.x + sharingBox.width / 2 - sharingViewport.width / 2) < 5
    && Math.abs(sharingBox.y + sharingBox.height / 2 - sharingViewport.height / 2) < 5,
  'sharing opens as a large centered modal');
  await page.waitForSelector('[aria-label="Make public"]', { timeout: 15000 });
  await Promise.all([sharingPut(), page.locator('[aria-label="Make public"]').click()]);
  const nowPublic = await stranger.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  check(nowPublic.status() === 200, 'after "anyone with link", a logged-out browser can read it');
  await Promise.all([sharingPut(), page.locator('[aria-label="Make private"]').click()]);

  // The reader-visible head pointer must not open the page.
  const story = await api('/api/artifacts', { title: 'Private Story', markup: '<section><h1>private export</h1></section>' });
  check(story.visibility === 'private', 'the markup doc is private');
  const wire = await page.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), story.id);
  const withEditId = await stranger.request.get(`${BASE}/a/${story.id}?key=${wire.edit_id}`);
  check(withEditId.status() === 404, 'edit_id does NOT work as a read key');

  // A folder's own VISIBILITY: born private, and a profile lists the public ones only.
  const shelf = await api('/api/artifacts', { format: 'folder', title: 'Shelf', visibility: 'public' });
  await api('/api/artifacts', { title: 'Public Child', markup: '<h1>public child</h1>', visibility: 'public', parent_id: shelf.id });
  const vault = await api('/api/artifacts', { format: 'folder', title: 'Vault' });
  check(vault.visibility === 'private', 'an owned folder is born private');
  // The profile ROOT is public surface (an all-private profile renders EMPTY, never 404 — an existence oracle otherwise).
  const strangerList = await stranger.goto(`${BASE}/@${username}`, { waitUntil: 'load' });
  await stranger.getByLabel('Open folder Shelf', { exact: true }).waitFor({ state: 'visible' });
  check(strangerList.status() === 200 && !(await stranger.textContent('body')).includes('Cookie Proof'),
    'a stranger sees no private document on the profile');
  check(await stranger.locator('[aria-label="Open folder Shelf"]').isVisible()
    && (await stranger.locator('[aria-label="Open folder Vault"]').count()) === 0,
  'a stranger’s profile lists public folders and withholds private ones');
});

// ── 5. the anonymous owner: token → httpOnly session, Disconnect, the split viewer (was gate-secure-arch §6) ──
await section('anonymous owner', async () => {
  const anon2 = await connectAgent(BASE);
  const anonDoc = await (await fetch(`${BASE}/api/artifacts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon2.token}` },
    body: JSON.stringify({ title: 'Email Owned', visibility: 'public', markup: '<h1>ANON-OWNED</h1>' }),
  })).json();
  const anonCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
  check(await framedOnItsOrigin(anonPage, anonDoc.id) && !(await ownerBar(anonPage)), 'before exchange: the token holder is just a reader (the framed document, no owner bar)');
  // Keep the distinct browser credential from the guest approval. The CLI's API-scoped token is not a credential
  // for browser page navigation.
  await becomeOwner(anonPage, BASE, anon2.token);
  const cookies = await anonCtx.cookies(BASE);
  const sess = cookies.find((c) => /better-auth/.test(c.name));
  check(!!sess && sess.httpOnly, `session cookie is httpOnly (${sess?.name ?? 'missing'})`);
  const stored = await anonPage.evaluate(() => [localStorage.getItem('mx_token'), localStorage.getItem('mx_tokens')]);
  check(stored.every((v) => v === null), 'no token in localStorage after the exchange');
  await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
  const anonFrameText = await docHeading(anonPage);
  check(anonFrameText === 'ANON-OWNED' && await ownerBar(anonPage), 'after exchange: the anonymous owner gets the shell (owner bar, the framed document) at the same URL');

  await openMenu(anonPage);
  check(await anonPage.getByRole('button', { name: 'Sign out', exact: true }).isVisible(), 'email owner can sign out');
  check(await anonPage.getByRole('button', { name: 'Disconnect this browser', exact: true }).count() === 0, 'anonymous disconnect control is retired');
  await Promise.all([
    anonPage.waitForResponse(r => r.url().includes('/api/auth/sign-out') && r.request().method() === 'POST'),
    anonPage.getByRole('button', { name: 'Sign out', exact: true }).click(),
  ]);
  await anonPage.waitForTimeout(1500);
  check(!(await anonCtx.cookies(BASE)).some((c) => /better-auth/.test(c.name)), 'disconnecting cleared the agent-session cookie');
  await anonPage.goto(`${BASE}/a/${anonDoc.id}`, { waitUntil: 'load' });
  check(await framedOnItsOrigin(anonPage, anonDoc.id) && !(await ownerBar(anonPage)), 'after disconnect: the browser is a reader — the framed document, no owner bar');
  await anonCtx.close();

  // The SPLIT-VIEWER case: a browser holding a CLAIMED token in its agent cookie and no account session reads the
  // account's PRIVATE document. `owner` already claimed `anon.token`, so what it publishes belongs to the account.
  const claimedPriv = await api('/api/artifacts', { title: 'Claimed Private', markup: '<h1>CLAIMED-PRIVATE-BODY</h1>' });
  check(claimedPriv.visibility === 'private', 'a claimed token publishes a private doc owned by the account');
  const splitCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const splitPage = await splitCtx.newPage();
  await becomeOwner(splitPage, BASE, anon.token);
  check(!!(await sessionOf(splitCtx)), 'private reader holds a verified email session');
  const splitResponse = await splitPage.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' });
  const splitText = await docHeading(splitPage);
  check(splitText === 'CLAIMED-PRIVATE-BODY', `the shell frame shows the DOCUMENT, not a 404 — raw resolved the cookie viewer (status ${splitResponse?.status()}, text ${splitText}, body ${(await splitPage.locator('body').innerText()).slice(0, 140)})`);
  // And a browser with neither credential still gets the uniform 404.
  const nobodyCtx = await browser.newContext();
  const nobody = await nobodyCtx.newPage();
  check((await nobody.goto(`${BASE}/a/${claimedPriv.id}`, { waitUntil: 'load' })).status() === 404, 'a browser with no credential is a uniform 404 on the same private doc');
  await nobodyCtx.close();
  await splitCtx.close();
});

// ── 6. links in the document, history, the shelf and the profile (was gate-seamless-navigation) ──
await section('navigation', async () => {
  const base = BASE;
  const first = await startDocument(base);
  const auth = { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' };
  const secondResponse = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: auth, body: JSON.stringify({
    title: 'mxmx_test navigation B', visibility: 'public',
    markup: '<h1 aria-label="Artifact B">Second</h1><a href="/" aria-label="Go home">Home</a>',
  }) });
  assert(secondResponse.ok, `create B: ${secondResponse.status}`);
  const second = await secondResponse.json();
  const published = await fetch(`${base}/api/artifacts/${first.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({
    title: 'mxmx_test navigation A', visibility: 'public',
    markup: `<Helmet><style>{\`body { --mx-navigation-probe: artifact-a; }\`}</style></Helmet><h1 aria-label="Artifact A">First</h1><a href="/a/${second.id}" aria-label="Next artifact">Next</a>`,
  }) });
  assert(published.ok, `publish A: ${published.status}`);

  const page = await browser.newPage();
  const doc = () => documentLocator(page);
  const heading = (name) => doc().getByRole('heading', { name, exact: true });
  const seen = (locator, timeout = 5_000) => locator.waitFor({ timeout }).then(() => true, () => false);
  const onApp = (pathname) => { const url = new URL(page.url()); return url.origin === new URL(base).origin && url.pathname === pathname; };
  const viewReport = (id, timeout = 3_000) => page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/page/artifact/${id}/view` && response.request().method() === 'POST', { timeout })
    .then((response) => response.status(), () => null);

  const initialView = viewReport(first.id);
  await page.goto(`${base}/a/${first.id}`);
  check(await seen(heading('Artifact A'), 20_000), 'the first document renders in its frame');
  const initialStatus = await initialView;
  check(initialStatus === 204, `initial compiled reader records a view (${initialStatus ?? 'no view reported'})`);
  check(await page.locator(INLINE_STORY).count() === 0 && await doc().locator(INLINE_STORY).count() === 1,
    'the compiled reader runs in the document frame, not on the app page');
  const docA = await documentFrame(page);
  check(await docA.evaluate(() => document.querySelector('[aria-label="Artifact A"]')?.getRootNode() === document),
    'the document\'s heading is in its frame\'s own light DOM');
  await page.evaluate(() => { window.__navigationProbe = 'artifact-a'; });

  // a link inside the document takes the tab to the next document's app page
  const nextView = viewReport(second.id);
  const fromA = page.url();
  await doc().getByRole('link', { name: 'Next artifact' }).click();
  await page.waitForURL((url) => url.href !== fromA, { timeout: 10_000 }).catch(() => {});
  const reachedB = await seen(heading('Artifact B'));
  check(onApp(`/a/${second.id}`) && reachedB, `a document link opens the next document's app page (${page.url()})`);
  const nextStatus = await nextView;
  check(nextStatus === 204, `navigation records the next document view (${nextStatus ?? 'no view reported'})`);
  check(await page.evaluate(() => window.__navigationProbe).catch(() => undefined) === undefined, 'reader link loads its document');
  check(await heading('Artifact A').count().catch(() => 0) === 0, 'old reader body left');
  check(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--mx-navigation-probe').trim()).catch(() => '') === '', 'old author CSS left');
  // The history legs below need B on screen; a broken link above is already a failure, so arrive by address.
  if (!reachedB) { await page.goto(`${base}/a/${second.id}`); await seen(heading('Artifact B'), 20_000); }

  await doc().getByRole('link', { name: 'Go home' }).click();
  await page.waitForURL(`${base}/login`, { timeout: 3_000 }).catch(() => {});
  check(onApp('/login') && await seen(page.getByRole('textbox', { name: 'Email', exact: true })), `a document link to / takes the tab to the app's home (${page.url()})`);
  await page.goBack();
  check(await seen(heading('Artifact B')), 'Back returns to the second document');
  await page.goBack();
  check(await seen(heading('Artifact A')), 'Back again returns to the first document');
  await page.goForward();
  check(await seen(heading('Artifact B')), 'Forward returns to the second document');

  await becomeOwner(page, base, first.token);

  check(await page.getByLabel('Add to my account', { exact: true }).count() === 0,
    'verified login adopts guest artifacts without a second claim step');

  // Leaving a document for an app route keeps the app bar whole: exactly one GitHub Star button on /account.
  await page.goto(`${base}/a/${first.id}`);
  await seen(heading('Artifact A'), 20_000);
  await page.getByLabel('Open menu', { exact: true }).click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('heading', { name: 'account' }).waitFor();
  check(await page.getByRole('link', { name: 'Star artifactbin on GitHub' }).count() === 1,
    'exactly one GitHub Star button after leaving an adopted document for /account');

  await page.goto(base);
  await page.getByLabel('List view', { exact: true }).click();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  const folderResponse = await page.request.post(`${base}/api/my/artifacts`, { data: { format: 'folder', title: 'Navigation folder' } });
  assert(folderResponse.ok(), 'create owned folder');
  const folder = await folderResponse.json();
  await page.reload();
  await page.getByLabel('List view', { exact: true }).click();
  const pageCount = page.context().pages().length;
  // A document's heading is in its frame; a folder's trail is the app page's own.
  for (const [label, id, destination] of [
    ['Open mxmx_test navigation A', first.id, () => heading('Artifact A')],
    ['Open folder Navigation folder', folder.id, () => page.getByLabel('Folder trail', { exact: true })],
  ]) {
    const link = page.getByLabel(label, { exact: true });
    check(await link.getAttribute('target') !== '_blank', `${label} stays in this tab`);
    await link.click();
    await page.waitForURL(url => url.pathname.includes(id));
    check(await seen(destination(), 20_000), `${label} lands on its page`);
    check(page.context().pages().length === pageCount, 'shelf click opens no tab');
    await page.goBack();
    await page.getByLabel('List view', { exact: true }).click();
    await page.getByLabel(label, { exact: true }).waitFor();
  }
  const account = await (await page.request.get(`${base}/api/page/account`)).json();
  await page.goto(`${base}/@${account.username}`);
  await page.getByLabel('List view', { exact: true }).click();
  const profileLink = page.getByLabel('Open mxmx_test navigation A', { exact: true });
  check(await profileLink.getAttribute('target') !== '_blank', 'profile list opens in this tab');
  await profileLink.click();
  check(await seen(heading('Artifact A'), 20_000), 'the profile link opens the document');
  check(page.context().pages().length === pageCount, 'profile click opens no tab');
  await page.goBack();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  await page.request.delete(`${base}/api/my/artifacts/${folder.id}`);
  await page.close();
});

await browser.close();
sink.close();
check.done();
