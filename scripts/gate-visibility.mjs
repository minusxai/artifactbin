/**
 * Gate: the visibility ACL and pretty URLs, in a real browser, end to end.
 *
 * The vitest suite proves the ACL decisions in-process; what only a browser
 * can prove is the delivery seam this feature leans on:
 *
 *   1. a PRIVATE html doc renders for its owner — the sandboxed iframe's
 *      document request must carry the session cookie (SameSite=Lax,
 *      same-site iframe navigation; the one behavior nothing in jsdom can
 *      answer), while a logged-out browser gets the uniform 404
 *   2. /a/<id> self-heals to /@username/... in the location bar, and a
 *      mangled pretty URL (wrong user, stale title) heals too
 *   3. the ShareLink dialog really flips visibility from the page
 *   4. the dashboard's folder move lands through the PICKER, and the canonical
 *      URL does NOT follow it — nesting is never in a URL
 *   5. a folder is a document: its own visibility decides who may open it, and
 *      the server decides per viewer what it lists
 *
 * The login code is read from the same local MAIL SINK gate-email-login uses:
 *
 *   usage:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *     node scripts/gate-visibility.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const EMAIL = `mxmx_test_vis_${Date.now().toString(36)}@example.com`;

const sink = await startMailSink();

const browser = await chromium.launch();
const owner = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await owner.newPage();
await loginViaEmail(page, BASE, sink, EMAIL);
// Assert the session EXISTS rather than that login returned: a `check(true)`
// here passed on every run, including the ones where the cookie never landed.
const sessionCookie = (await owner.cookies(BASE)).find((c) => /better-auth/.test(c.name));
check(Boolean(sessionCookie), 'email-code login landed a session cookie');

// A user-owned token: mint anonymously, claim from the session context.
const anon = await mintAnon(BASE);
const claimed = await page.evaluate(async (t) => {
  const r = await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
  return r.status;
}, anon.token);
check(claimed === 200, 'the session claimed the token');

const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const username = (await page.evaluate(async () => (await (await fetch('/api/my/profile')).json()).username));
check(/^mxmx_test_vis_[a-z0-9]+_[a-z0-9]{4}$/.test(username), `auto-assigned username looks right (${username})`);

// ── 1. private doc: iframe + cookie for the owner, 404 logged out ─────────
const doc = await api('/api/artifacts', {
  title: 'Cookie Proof',
  markup: '<h1 id="pf">IFRAME-COOKIE-OK</h1>',
});
check(doc.visibility === 'private', 'owned doc is born private');

await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
const iframeText = await page.frameLocator('iframe[title="artifact"]').locator('#pf').textContent({ timeout: 20000 }).catch(() => null);
check(iframeText === 'IFRAME-COOKIE-OK', 'PRIVATE html renders for the owner — the sandboxed iframe request carried the session cookie');

const strangerCtx = await browser.newContext();
const stranger = await strangerCtx.newPage();
const strangerResp = await stranger.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check(strangerResp.status() === 404, 'the same doc is a uniform 404 logged out');

// ── 2. pretty URLs self-heal in the location bar ──────────────────────────
await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check(
  page.url() === `${BASE}/@${username}/${doc.id}-cookie-proof`,
  `/a/<id> healed to the canonical pretty URL (${new URL(page.url()).pathname})`,
);
await page.goto(`${BASE}/@totally_wrong/${doc.id}-stale-name`, { waitUntil: 'load' });
check(page.url().includes(`/@${username}/${doc.id}-cookie-proof`), 'a mangled pretty URL heals by id');

// ── 3. ShareLink flips visibility from the page ────────────────────────────
// Every interaction waits for the SERVER to answer rather than a fixed pause:
// a click that lands before React hydrates does nothing and raises nothing, so
// a sleep here turns a real failure into a coin flip (it flaked exactly once).
const sharingPut = () => page.waitForResponse(
  (r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200,
  { timeout: 15000 },
);
// Reading has no bar; the artifact controls carry the sharing surface.
await page.locator('[aria-label="Open artifact controls"]').click();
await page.locator('[aria-label="Share"]').first().click();
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
const backPrivate = await stranger.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check(backPrivate.status() === 404, 'flipping back to private locks it again');

// ── 3b. a PRIVATE markup doc still exports ────────────────────────────────
// The exporter drives a headless browser with no session, so this is the one
// path that exercises the signed export key end to end. It used to reuse
// `edit_id` — a value printed in every reader's HTML — so this check also
// guards that the replacement actually works in the real render.
const story = await api('/api/artifacts', {
  title: 'Private Story',
  markup: '<section><h1>private export</h1></section>',
});
check(story.visibility === 'private', 'the markup doc is private');
const ownerShot = await page.request.get(`${BASE}/a/${story.id}/export`);
check(ownerShot.status() === 200, `the OWNER can export a private markup doc (${ownerShot.status()})`);
check((ownerShot.headers()['content-type'] ?? '').includes('image/png'), 'and gets real PNG bytes back');
const strangerShot = await stranger.request.get(`${BASE}/a/${story.id}/export`);
check(strangerShot.status() === 404, 'a stranger cannot export it');
// The reader-visible head pointer must not open the page.
const wire = await page.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), story.id);
const withEditId = await stranger.request.get(`${BASE}/a/${story.id}?key=${wire.edit_id}`);
check(withEditId.status() === 404, 'edit_id does NOT work as a read key');

// ── 4. the dashboard's folder move, through the PICKER ────────────────────
// Placement is an id on the wire and a NAME on the screen: the row chooses
// from the account's own folders, and its own subtree is greyed (the cycle
// rule, drawn) rather than refused after the fact.
const reports = await api('/api/artifacts', { format: 'folder', title: 'Reports' });
check(reports.format === 'folder', 'a folder is created with no content');
await page.goto(`${BASE}/`, { waitUntil: 'load' });
// The strip is the folder's home on the dashboard.
await page.waitForSelector('[aria-label="Open folder Reports"]', { timeout: 20000 });
check(true, 'the dashboard lists the folder in its own strip');
// Retry the opening click until the menu actually appears: the row is a
// client component, and a pre-hydration click is silently swallowed.
const openMove = async () => {
  await page.locator('[aria-label="More actions for Cookie Proof"]').first().click();
  await page.locator('[aria-label="Move Cookie Proof"]').first().click();
};
await openMove();
await page.waitForSelector('[aria-label="Filter folders"]', { timeout: 5000 }).catch(async () => {
  await openMove();
  await page.waitForSelector('[aria-label="Filter folders"]', { timeout: 15000 });
});
await Promise.all([
  page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200, { timeout: 15000 }),
  page.locator('[aria-label="Move to Reports"]').first().click(),
]);
await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
// THE ADDRESS DOES NOT MOVE. Nesting is never in a URL: a folder is an
// artifact with its own address, and the trail is drawn on its page.
check(
  new URL(page.url()).pathname === `/@${username}/${doc.id}-cookie-proof`,
  `the canonical URL is id-anchored and survives the move (${new URL(page.url()).pathname})`,
);
const placed = await page.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), doc.id);
check(placed.parent_id === reports.id, 'and the row really moved (parent_id names the folder)');

// ── 5. a folder is read by its own ACL, and lists by the reader's ─────────
// A folder page IS a document, so "who may open it" is the artifact's own
// visibility; what it LISTS is decided per viewer on the server.
const shelf = await api('/api/artifacts', { format: 'folder', title: 'Shelf', visibility: 'public' });
const shown = await api('/api/artifacts', { title: 'Public Child', markup: '<h1>public child</h1>', visibility: 'public', parent_id: shelf.id });
check(shown.parent_id === shelf.id, 'a document is filed under the folder at publish');
await api('/api/artifacts', { title: 'Hidden Child', markup: '<h1>hidden child</h1>', parent_id: shelf.id });

// The OWNER is served the shell, so the listing is in the document frame.
await page.goto(`${BASE}/a/${shelf.id}`, { waitUntil: 'load' });
const ownerFrame = page.frameLocator('iframe[title="artifact"]');
await ownerFrame.locator('[aria-label="Open Public Child"]').waitFor({ timeout: 20000 });
await ownerFrame.locator('[aria-label="Open Hidden Child"]').waitFor({ timeout: 20000 });
check(true, 'the owner sees every child of their folder');
// The glyph is resolved by the SERVER for <Files>, which names no <Icon>: a
// listing that draws no glyph is the failure this cannot see any other way.
const glyphs = await ownerFrame.locator('[aria-label="Open Hidden Child"] [data-glyph] svg').count();
check(glyphs > 0, 'a row with no card draws its format glyph');

// A STRANGER reads the public folder top-level and sees the PUBLIC child only:
// unlisted and private children are listed nowhere, and a folder page is a
// listing.
const strangerFolder = await stranger.goto(`${BASE}/a/${shelf.id}`, { waitUntil: 'load' });
check(strangerFolder.status() === 200, 'a public folder opens for a stranger');
await stranger.waitForSelector('[aria-label="Open Public Child"]', { timeout: 20000 });
check(!(await stranger.textContent('body')).includes('Hidden Child'), 'a stranger never sees a private child in the listing');

// A PRIVATE folder is the uniform 404, exactly like a private document.
const vault = await api('/api/artifacts', { format: 'folder', title: 'Vault' });
check(vault.visibility === 'private', 'an owned folder is born private');
const strangerVault = await stranger.goto(`${BASE}/a/${vault.id}`, { waitUntil: 'load' });
check(strangerVault.status() === 404, 'a private folder is the uniform 404 for a stranger');

// The profile ROOT is public surface (public docs list there; an all-private
// profile renders EMPTY, never 404 — an existence oracle otherwise).
const strangerList = await stranger.goto(`${BASE}/@${username}`, { waitUntil: 'load' });
check(strangerList.status() === 200 && !(await stranger.textContent('body')).includes('Cookie Proof'),
  'a stranger sees no private document on the profile');
// And no FOLDER either, public or not: a stranger's profile is documents, flat.
// The public index is `format = 'markup'` (lib/users listPublicArtifactsByUser),
// so the strip the owner's own root grew has nothing to draw here.
check((await stranger.locator('[aria-label="Folders"]').count()) === 0
  && !(await stranger.textContent('body')).includes('Shelf'),
  'a stranger\u2019s profile lists no folder, not even a public one');

await browser.close();
sink.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nvisibility + pretty-url gate: all green');
