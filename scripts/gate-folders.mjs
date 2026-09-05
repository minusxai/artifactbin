/**
 * Gate: a FOLDER, in three real browsers at once.
 *
 * A folder is an artifact with `format: 'folder'` whose stored source is a
 * two-line scaffold — one `<Query>` over its own children and one `<Files>`.
 * Everything that makes that a good idea is a delivery property no unit test
 * can see, so this drives the whole thing through Chromium:
 *
 *   1. the OWNER is served the shell, and the frame draws the listing — a
 *      card where a child has one, a server-resolved format GLYPH where it
 *      does not. A folder names no `<Icon>` anywhere, so a listing with holes
 *      in it is green everywhere and blank in production.
 *   2. `New folder` in the bar makes one INSIDE this folder, inline: no
 *      dialog, no navigation, and the tile arrives on its own.
 *   3. a document published BY AN AGENT under the folder appears in the open
 *      page with NO RELOAD and no frame swap — a folder's source names its own
 *      id as a table, so it is a data dependency of itself and a child write
 *      wakes it through the live path that already existed.
 *   4. an EDITOR of the folder gets the shell and the same verb; a STRANGER is
 *      served the document top-level, sees the public child, the private one
 *      NEVER, and no chrome at all.
 *   5. the picker moves the document out, and the listing follows.
 *   6. the dashboard lists the folder in its own strip, with its count.
 *   7. renaming one is the editor's Title field — a folder has no second door.
 *   8. deleting one from the strip TRASHES it with its contents, and the trash
 *      lists both — P3 made delete recoverable, so the row is offered rather
 *      than refused and the confirm names what goes.
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

const roleTrigger = (page, email) => page.locator(`[aria-label="Role for ${email}"]`);
const pickRole = async (page, email, label) => {
  await roleTrigger(page, email).click();
  await page.locator('[role="option"]', { hasText: label }).click();
};
const sharingPut = (page) => page.waitForResponse(
  (r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200,
  { timeout: 15000 },
);

const sink = await startMailSink();
const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const editorCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const strangerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
const editor = await editorCtx.newPage();
const stranger = await strangerCtx.newPage();

/*
 * A HYDRATION MISMATCH IS SILENT TO EVERY ASSERTION BELOW. React answers #418
 * by discarding the server tree and repainting the root, so the listing is
 * still there afterwards and every locator finds it — the only witness is the
 * console. <Files> is rendered twice (a string on the server, a DOM in the
 * browser) and it injects markup, so it is exactly the shape that goes wrong.
 */
const mismatches = [];
/** What the delete confirm actually said, captured from the real dialog. */
let confirmText = '';
for (const [who, p] of [['owner', owner], ['stranger', stranger]]) {
  p.on('console', (m) => {
    const text = m.text();
    if (/hydrat|#418|did not match|server rendered HTML/i.test(text)) mismatches.push(`${who}: ${text.slice(0, 160)}`);
  });
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
const seen = await api('/api/artifacts', {
  title: 'Opening Note', visibility: 'public', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Opening Note</h1><p>the first note.</p></div>',
});
check(seen.parent_id === folder.id, 'a public document is filed under it at publish');
await api('/api/artifacts', {
  title: 'Quiet Note', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Quiet Note</h1></div>',
});

// ── 1. the owner's shell, and the listing inside the frame ────────────────
await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
const ownerFrame = owner.frameLocator('iframe[title="artifact"]');
await ownerFrame.locator('[aria-label="Open Opening Note"]').waitFor({ timeout: 20000 });
await ownerFrame.locator('[aria-label="Open Quiet Note"]').waitFor({ timeout: 20000 });
check(true, 'the owner is served the shell, and the listing draws both children');
// A public child has an og card; a private one cannot (the frame's request
// carries no session), so it draws its format glyph instead. The glyph is
// resolved by the SERVER for a component that names no <Icon> — the one
// failure that is invisible to every unit test and to innerText alike.
check(
  (await ownerFrame.locator('[aria-label="Open Opening Note"] img').count()) === 1,
  'a link-readable child draws its own card',
);
check(
  (await ownerFrame.locator('[aria-label="Open Quiet Note"] [data-glyph="markup"] svg').count()) === 1,
  'a private child draws a real format GLYPH, not a hole',
);

// ── 2. New folder, inline, from the bar ──────────────────────────────────
await owner.locator('[aria-label="Open artifact controls"]').click();
await owner.locator('[aria-label="New folder"]').click();
await owner.fill('[aria-label="Folder name"]', 'Archive');
await Promise.all([
  owner.waitForResponse((r) => r.url().endsWith('/api/my/artifacts') && r.request().method() === 'POST' && r.status() === 201, { timeout: 15000 }),
  owner.press('[aria-label="Folder name"]', 'Enter'),
]);
check((await owner.locator('[aria-label="Folder name"]').count()) === 0, 'the name field closes on its own');
await ownerFrame.locator('[aria-label="Open Archive"]').waitFor({ timeout: 20000 });
check(true, 'the folder made from the bar lands INSIDE this one, with no navigation');

// ── 3. an agent's publish reaches the open page, live ────────────────────
// Mark the page and the frame ELEMENT: a reload loses the mark, and a frame
// swap is a different element. Both are what "live" has to mean here.
await owner.evaluate(() => {
  window.__gateMark = 'kept';
  window.__gateFrame = document.querySelector('iframe[title="artifact"]');
});
const live = await api('/api/artifacts', {
  title: 'Live Note', visibility: 'public', parent_id: folder.id,
  markup: '<div class="p-8"><h1>Live Note</h1></div>',
});
await ownerFrame.locator('[aria-label="Open Live Note"]').waitFor({ timeout: 20000 });
check(true, 'a document published by an agent joins the OPEN folder listing');
check(
  await owner.evaluate(() => window.__gateMark === 'kept' && window.__gateFrame === document.querySelector('iframe[title="artifact"]')),
  'and it arrived with no page reload and no frame swap',
);

// ── 4. an editor, and a stranger ─────────────────────────────────────────
await owner.locator('[aria-label="Open artifact controls"]').click();
await owner.locator('[aria-label="Share"]').first().click();
await owner.waitForSelector('[aria-label="Invite email"]', { timeout: 15000 });
await owner.fill('[aria-label="Invite email"]', EDITOR_EMAIL);
await Promise.all([sharingPut(owner), owner.click('[aria-label="Add email"]')]);
await roleTrigger(owner, EDITOR_EMAIL).waitFor({ timeout: 15000 });
await Promise.all([sharingPut(owner), pickRole(owner, EDITOR_EMAIL, 'can edit')]);
await owner.keyboard.press('Escape');

await editor.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
const editorFrame = editor.frameLocator('iframe[title="artifact"]');
await editorFrame.locator('[aria-label="Open Opening Note"]').waitFor({ timeout: 20000 });
check(true, 'an invited editor is served the shell over the same folder');
await editor.locator('[aria-label="Open artifact controls"]').click();
check((await editor.locator('[aria-label="New folder"]').count()) === 1, 'and may make a folder inside it');
// An editor reads the folder as an insider: the shelf is the whole shelf.
check((await editorFrame.locator('[aria-label="Open Quiet Note"]').count()) === 1, 'an editor sees the private child too');
await editor.keyboard.press('Escape');

const strangerVisit = await stranger.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
check(strangerVisit.status() === 200, 'a stranger may open the public folder');
await stranger.waitForSelector('[aria-label="Open Opening Note"]', { timeout: 20000 });
// Served TOP-LEVEL: the document itself, with no shell around it.
check((await stranger.locator('iframe[title="artifact"]').count()) === 0, 'and gets the document itself, not the shell');
check((await stranger.locator('[aria-label="New folder"]').count()) === 0, 'with none of the owner’s verbs');
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
// The tree the picker draws is the account's own folders, by NAME.
check((await owner.locator('[aria-label="Move to Field Notes"]').count()) === 1, 'the picker offers the account’s folders by name');
await Promise.all([
  owner.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200, { timeout: 15000 }),
  owner.locator('[aria-label="Move to root"]').first().click(),
]);
const moved = await owner.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), live.id);
check(moved.parent_id === null, 'moving to root really files it at the root');
await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await owner.frameLocator('iframe[title="artifact"]').locator('[aria-label="Open Opening Note"]').waitFor({ timeout: 20000 });
check(
  (await owner.frameLocator('iframe[title="artifact"]').locator('[aria-label="Open Live Note"]').count()) === 0,
  'and the folder stops listing it',
);

// ── 6. the dashboard strip ───────────────────────────────────────────────
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
await owner.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
const tile = owner.locator('[aria-label="Open folder Field Notes"]');
await tile.waitFor({ timeout: 15000 });
check(true, 'the dashboard lists the folder in its own strip');
// Deleting a folder is deleting everything in it, so the row SAYS how much
// before anyone clicks — the count the confirm then repeats in a sentence.
await owner.locator('[aria-label="More actions for Field Notes"]').first().click();
const del = owner.locator('[aria-label="Delete Field Notes"]').first();
await del.waitFor({ timeout: 15000 });
check(((await del.textContent()) ?? '').includes('inside'), 'the row says how much is in it');
await owner.keyboard.press('Escape');

// ── 7. renaming a folder is the editor's Title field, and nothing else ────
// A folder has no second rename door: the field writes `title` through the
// edit protocol like every other change. That protocol refused a folder
// outright until this phase, so the shell opened an editor that could not
// commit and the name went back with a 400 nobody was shown.
await owner.goto(`${BASE}/a/${folder.id}`, { waitUntil: 'load' });
await owner.frameLocator('iframe[title="artifact"]').locator('[aria-label="Open Opening Note"]').waitFor({ timeout: 20000 });
await owner.locator('[aria-label="Open artifact controls"]').click();
await owner.locator('[aria-label="Edit artifact"]').click();
await owner.waitForSelector('[aria-label="Title"]', { timeout: 15000 });
await owner.fill('[aria-label="Title"]', 'Field Notes 2026');
await owner.waitForResponse(
  (r) => r.url().includes('/edits') && r.request().method() === 'POST' && r.status() === 200,
  { timeout: 15000 },
);
const renamed = await owner.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), folder.id);
check(renamed.title === 'Field Notes 2026', `the title field renames the folder (${renamed.title})`);

// ── 8. deleting a folder from the strip trashes it WITH its contents ─────
// P3 made delete a trash: the folder and everything under it go in ONE
// statement, and nothing is ever erased, so it stays recoverable with no
// deadline. The strip's row is offered rather than refused, and what it takes
// is what the confirm named.
await owner.goto(`${BASE}/`, { waitUntil: 'load' });
await owner.waitForSelector('[aria-label="Folders"]', { timeout: 20000 });
owner.once('dialog', (d) => {
  confirmText = d.message();
  void d.accept();
});
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

check(mismatches.length === 0, `no hydration mismatch on either render of the listing${mismatches.length ? ` — ${mismatches[0]}` : ''}`);

await browser.close();
sink.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nfolders gate: all green');
