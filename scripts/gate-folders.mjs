/**
 * Gate: a FOLDER's page, in three real browsers at once.
 *
 * A folder has no content. Its listing is app data — answered by the page
 * endpoint, inlined into the HTML by the app server, drawn by web/pages/Folder
 * over the shelf the dashboard already has. Everything that makes that a good
 * idea is a delivery property no unit test can see, so this drives it through
 * Chromium:
 *
 *   1. the LISTING IS IN THE FIRST HTML BYTE. The measured reason for the whole
 *      change: as a document the rows painted LAST, behind a sandboxed runtime
 *      boot an opaque origin cannot cache. So this reads the raw HTML of the
 *      owner's own page — before any script has run — and the children have to
 *      be in it. Asserted on the BYTES rather than on the DOM, because a DOM
 *      assertion passes just as well when the rows arrive a second later.
 *   2. `New folder` in the shelf's bar makes one INSIDE this folder, inline:
 *      no dialog, no navigation, and the tile arrives on its own.
 *   3. a document published BY AN AGENT appears in the open page with NO
 *      RELOAD — a folder follows its own channel on the events stream, so a
 *      child write arrives as the `data` frame a dataset write already sends.
 *   4. an EDITOR of the folder gets the same verbs; a STRANGER gets the page,
 *      the public child, never the private one, and no verbs at all.
 *   5. the picker moves the document out, and the listing follows.
 *   6. the dashboard lists the folder in its own strip, with its count, and
 *      offers RENAME where a document is offered an editor.
 *   7. renaming happens on the NAME itself — a folder has no editor to open.
 *   8. the folder's own og card renders: the camera photographs the APP PAGE
 *      (`/a/<id>?key=`, target `main`), a different address from every other
 *      artifact's and the one that answered `render_failed` in the past.
 *   9. deleting one from the strip TRASHES it with its contents, and the trash
 *      lists both.
 *
 * Two logged-in contexts and one stranger, one mail sink. usage:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.
 *
 *     node scripts/gate-folders.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_folders_owner_${stamp}@example.com`;
const EDITOR_EMAIL = `mxmx_test_folders_editor_${stamp}@example.com`;

const sink = await startMailSink();
const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const editorCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const strangerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
const editor = await editorCtx.newPage();
const stranger = await strangerCtx.newPage();

/*
 * A PAGE THAT THREW IS STILL A PAGE FULL OF LOCATORS THAT FIND NOTHING, and
 * only the message says which. The folder page composes app chrome the shelf
 * owns, so a prop the endpoint stopped sending surfaces here as a render error
 * and in no assertion below.
 */
const errors = [];
for (const [who, p] of [['owner', owner], ['stranger', stranger]]) {
  p.on('pageerror', (e) => errors.push(`${who}: ${String(e).slice(0, 160)}`));
}

await loginViaEmail(owner, BASE, sink, OWNER_EMAIL);
check(Boolean((await ownerCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'owner logged in');
await loginViaEmail(editor, BASE, sink, EDITOR_EMAIL);
check(Boolean((await editorCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'editor logged in');

// The owner's token — minted anonymously, claimed by the session. This is what
// stands in for the AGENT below: the same credential an agent would hold.
const anon = await mintAnon(BASE);
const claimed = await owner.evaluate(
  async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status,
  anon.token,
);
check(claimed === 200, 'owner claimed the token');

const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// ── the folder, and one child of each kind ────────────────────────────────
const folder = await api('/api/artifacts', { format: 'folder', title: 'Field Notes', visibility: 'public' });
check(folder.format === 'folder' && folder.visibility === 'public', 'a public folder, created with no content');
check(!folder.markup, 'and the create echo hands back no markup nobody sent');
const seen = await api('/api/artifacts', {
  title: 'Opening Note', visibility: 'public', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Opening Note</h1><p>the first note.</p></div>',
});
check(seen.parent_id === folder.id, 'a public document is filed under it at publish');
await api('/api/artifacts', {
  title: 'Quiet Note', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Quiet Note</h1></div>',
});

// A folder has no document to serve, at any address.
const rawStatus = (await owner.request.get(`${BASE}/a/${folder.id}/raw`)).status();
check(rawStatus === 404, `raw is the uniform 404 for a folder (${rawStatus})`);

// ── 1. the listing is in the FIRST HTML BYTE ─────────────────────────────
/*
 * THE MEASURED POINT OF THE WHOLE CHANGE, and the one assertion the DOM cannot
 * make: `page.goto` waits, so a listing that arrives a second late still finds
 * every locator. This reads the BYTES the server sent — with the owner's own
 * cookies, through the context's request client — and the children have to be
 * in them already, before a single script has run.
 */
const firstBytes = await ownerCtx.request.get(`${BASE}/a/${folder.id}`);
check(firstBytes.status() === 200, 'the owner’s folder address answers 200');
const html = await firstBytes.text();
check(html.includes('Opening Note') && html.includes('Quiet Note'), 'both children are in the FIRST HTML byte, before any script runs');
check(html.includes('Field Notes'), 'and so is the folder’s own name');

await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
check((await owner.locator('iframe[title="artifact"]').count()) === 0, 'a folder is never framed — it has no document');
await owner.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
await owner.locator('[aria-label^="Open Quiet Note"]').waitFor({ timeout: 20000 });
check(true, 'the owner’s page draws both children');
const head = () => owner.locator('main > header').first().textContent();
const headText = (await head()) ?? '';
check(headText.includes('Field Notes'), `the page names the folder it is (${headText.trim().slice(0, 60)})`);
check(/2 documents/.test(headText), `and counts what is on the shelf, as a sentence (${headText.trim().slice(0, 60)})`);

// ── 2. New folder, inline, from the shelf's own bar ──────────────────────
await owner.locator('[aria-label="New folder"]').click();
await owner.fill('[aria-label="Folder name"]', 'Archive');
await Promise.all([
  owner.waitForResponse((r) => r.url().endsWith('/api/my/artifacts') && r.request().method() === 'POST' && r.status() === 201, { timeout: 15000 }),
  owner.press('[aria-label="Folder name"]', 'Enter'),
]);
await owner.locator('[aria-label="Open folder Archive"]').waitFor({ timeout: 20000 });
check(true, 'the folder made from the bar lands INSIDE this one, with no navigation');

// ── 2b. an EMPTY folder is an invitation, not a blank page ───────────────
// A tile just CREATED carries the create reply's absolute url; one the server
// listed carries `/a/<id>`. Both navigate; resolve against the base so the gate
// does not care which it got.
const archiveHref = await owner.locator('[aria-label="Open folder Archive"]').getAttribute('href');
const archiveId = archiveHref.split('/').pop();
await owner.goto(new URL(archiveHref, BASE).toString(), { waitUntil: 'load' });
await owner.locator('[aria-label="Empty folder"]').waitFor({ timeout: 20000 });
const emptyText = (await owner.locator('[aria-label="Empty folder"]').textContent()) ?? '';
check(emptyText.includes('Nothing here yet.'), 'an empty folder says it is empty');
check(
  emptyText.includes('menu') && emptyText.includes(`parent_id: "${archiveId}"`),
  `and names both ways to fill it (${emptyText.trim().slice(0, 90)})`,
);
// NESTED, so it draws the trail — and the crumb is a link back up.
const crumb = owner.locator('[aria-label="Folder trail"] a');
check((await crumb.count()) === 1, 'a nested folder draws the trail above its name');
check(new URL(await crumb.first().getAttribute('href'), BASE).pathname === `/a/${folder.id}`, 'and the crumb links to the folder above it');
/*
 * The camera's element has to be VISIBLE even here. `main` is what
 * `/a/<id>/export` names, and an element with no height is a 15-second
 * `waitFor` and then `render_failed` — which is exactly how every folder's
 * card broke the last time the wrong address was named.
 */
const mainBox = await owner.locator('main').first().boundingBox();
check(Boolean(mainBox) && mainBox.height > 0, 'an empty folder still paints a <main> for the camera to photograph');

await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await owner.locator('[aria-label="Open folder Archive"]').waitFor({ timeout: 20000 });

// ── 3. an agent's publish reaches the open page, live ────────────────────
// Mark the page: a reload loses the mark, and that is what "live" has to mean.
await owner.evaluate(() => { window.__gateMark = 'kept'; });
const live = await api('/api/artifacts', {
  title: 'Live Note', visibility: 'public', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Live Note</h1></div>',
});
await owner.locator('[aria-label^="Open Live Note"]').waitFor({ timeout: 20000 });
check(true, 'a document published by an agent joins the OPEN folder listing');
check(await owner.evaluate(() => window.__gateMark === 'kept'), 'and it arrived with no page reload');

// ── 4. an editor, and a stranger ─────────────────────────────────────────
// A folder page carries no share menu of its own — sharing is the row's, from
// the shelf that lists it — so the invite goes through the browser door the
// menu would have called.
const shared = await owner.evaluate(async ({ id, email }) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shares: [{ email, role: 'editor' }] }),
})).status, { id: folder.id, email: EDITOR_EMAIL });
check(shared === 200, `the folder is shared with the editor (${shared})`);

await editor.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await editor.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
check(true, 'an invited editor opens the same folder page');
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

// ── 5. the picker moves the document out ─────────────────────────────────
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
const openMove = async () => {
  await owner.locator('[aria-label="More actions for Live Note"]').first().click();
  await owner.locator('[aria-label="Move Live Note"]').first().click();
};
await openMove();
await owner.waitForSelector('[aria-label="Filter folders"]', { timeout: 5000 }).catch(async () => {
  await openMove();
  await owner.waitForSelector('[aria-label="Filter folders"]', { timeout: 15000 });
});
check((await owner.locator('[aria-label="Move to Field Notes"]').count()) === 1, 'the picker offers the account’s folders by name');
await Promise.all([
  owner.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200, { timeout: 15000 }),
  owner.locator('[aria-label="Move to root"]').first().click(),
]);
const moved = await owner.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), live.id);
check(moved.parent_id === null, 'moving to root really files it at the root');
await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await owner.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
check((await owner.locator('[aria-label^="Open Live Note"]').count()) === 0, 'and the folder stops listing it');

// ── 6. the dashboard strip ───────────────────────────────────────────────
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
await owner.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
await owner.locator('[aria-label="Open folder Field Notes"]').waitFor({ timeout: 15000 });
check(true, 'the dashboard lists the folder in its own strip');
// Deleting a folder is deleting everything in it, so the row SAYS how much
// before anyone clicks — the count the confirm then repeats in a sentence.
await owner.locator('[aria-label="More actions for Field Notes"]').first().click();
const del = owner.locator('[aria-label="Delete Field Notes"]').first();
await del.waitFor({ timeout: 15000 });
check(((await del.textContent()) ?? '').includes('inside'), 'the row says how much is in it');
// …and RENAME is the verb that replaced the editor a folder never had.
check((await owner.locator('[aria-label="Rename Field Notes"]').count()) === 1, 'the tile menu offers rename');
check((await owner.locator('[aria-label="Edit Field Notes"]').count()) === 0, 'and no editor, because a folder has nothing to edit');
await owner.keyboard.press('Escape');

// ── 6b. …and so does the owner's own profile root ────────────────────────
const handle = await owner.evaluate(async () => (await (await fetch('/api/my/profile')).json()).username);
await owner.goto(`${BASE}/@${handle}`, { waitUntil: 'load' });
await owner.waitForSelector('[aria-label="Search artifacts"]', { timeout: 20000 });
check((await owner.locator('[aria-label="New folder"]').count()) === 1, 'the owner’s own profile offers New folder too');
const identity = owner.locator('[aria-label="Open your profile"]');
check((await identity.count()) === 1 && (await identity.getAttribute('href')) === `/@${handle}`,
  'and the masthead names the account by its handle, linking to the profile');
check((await owner.locator('[aria-label="Move Field Notes"]').count()) === 0, 'without granting the row verbs a profile withholds');

// ── 7. renaming happens on the NAME ──────────────────────────────────────
/*
 * A folder has no content, so there is no editor to open and no Title field to
 * type in: the name on its own page IS the control, writing through the
 * metadata door (PATCH {title}) rather than the replace one, which would
 * archive a version for a string.
 */
await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await owner.locator('[aria-label^="Open Opening Note"]').waitFor({ timeout: 20000 });
await owner.locator('[aria-label="Rename folder"]').click();
await owner.fill('[aria-label="Folder name"]', 'Field Notes 2026');
await Promise.all([
  owner.waitForResponse((r) => r.url().includes(`/api/my/artifacts/${folder.id}`) && r.request().method() === 'PATCH' && r.status() === 200, { timeout: 15000 }),
  owner.press('[aria-label="Folder name"]', 'Enter'),
]);
const renamed = await owner.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), folder.id);
check(renamed.title === 'Field Notes 2026', `the name renames the folder in place (${renamed.title})`);
check(((await head()) ?? '').includes('Field Notes 2026'), 'and the head shows the new name at once');

// ── 8. the folder's own og card renders from the APP PAGE ────────────────
/*
 * A DIFFERENT ADDRESS FROM EVERY OTHER ARTIFACT'S. The camera goes to
 * `/a/<id>?key=` with `main` as its target — the `?key=` is what keeps that
 * address on the SPA — where a document is photographed at `raw?chrome=0`.
 * When that branch named the wrong one, production answered a 25-byte
 * `{"error":"render_failed"}` for every folder there was.
 */
const card = await owner.request.get(`${BASE}/a/${folder.id}/export?mode=card`);
const cardBytes = (await card.body()).length;
check(card.status() === 200 && (card.headers()['content-type'] ?? '').startsWith('image/'),
  `the folder's og card renders (${card.status()} ${card.headers()['content-type']})`);
check(cardBytes > 2000, `and it is a real picture, not a refusal (${cardBytes} bytes)`);

// ── 9. deleting a folder from the strip trashes it WITH its contents ─────
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
await owner.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
let confirmText = '';
owner.once('dialog', (d) => { confirmText = d.message(); void d.accept(); });
await owner.locator('[aria-label="More actions for Field Notes 2026"]').first().click();
await Promise.all([
  owner.waitForResponse((r) => r.request().method() === 'DELETE' && r.status() === 200, { timeout: 15000 }),
  owner.locator('[aria-label="Delete Field Notes 2026"]').first().click(),
]);
check(/inside it\? They go to the trash, and you can restore them any time\./.test(confirmText), `the confirm names what goes with it (${confirmText})`);
await owner.locator('[aria-label="Open folder Field Notes 2026"]').waitFor({ state: 'detached', timeout: 15000 });
check(true, 'the tile leaves the strip with no reload');
// Read back through the OWNER's own door — the bearer route would answer 401
// to a browser and say nothing about the row. A trashed row is the uniform 404
// even to the person who trashed it: the trash page is the one reader that
// sees past the gate.
const gone = await owner.evaluate(async (ids) => {
  const status = {};
  for (const [name, id] of Object.entries(ids)) status[name] = (await fetch(`/api/my/artifacts/${id}`)).status;
  return status;
}, { folder: folder.id, child: seen.id });
check(gone.folder === 404 && gone.child === 404, `the folder and its child are gone, subtree and all (${gone.folder}/${gone.child})`);
const address = await owner.request.get(`${BASE}/a/${folder.id}`);
check(address.status() === 404, `and the folder's own address is the uniform 404 (${address.status()})`);
const trash = await owner.evaluate(async () => (await (await fetch('/api/page/trash')).json()));
const inTrash = new Set((trash.files ?? []).map((f) => f.id));
check(inTrash.has(folder.id) && inTrash.has(seen.id), 'and both are listed in the trash');

check(errors.length === 0, `no page error on either render of the listing${errors.length ? ` — ${errors[0]}` : ''}`);

await browser.close();
sink.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nfolders gate: all green');
