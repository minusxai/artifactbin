/**
 * Gate: COLLABORATION ROLES — who may read, comment and edit, and the delivery follows the role, live.
 *
 * One journey over four signed-in people and one logged-out visitor (folded in from the former collab-edit and
 * link-access gates). The vitest suite proves `effectiveRole`, the SQL scopes and every write door in-process; what
 * only a browser can prove is the delivery seam they feed:
 *
 *   GENERAL ACCESS (the link carries a ROLE) — the SAME stranger, the SAME link, one setting apart:
 *   1. link = `can view`     → a signed-in stranger reads the framed document, with no comment control
 *   2. owner flips it to `can comment`; the same link, reloaded → the comments control, NO edit affordance
 *   3. they select words in the frame and leave a comment; the owner, who never reloaded, watches the count arrive
 *   4. logged OUT on that same link → the document, no comments: ANONYMOUS CAPS AT VIEWER, because every write
 *      here is attributed and a URL is not an identity. This is also what keeps the crawler's fast path intact.
 *   5. flipped back to `can view` → the stranger loses all of it on reload
 *
 *   NAMED PEOPLE (a share carries a role):
 *   6. owner invites B from the share menu and promotes them to `can edit`; a COMMENTER may annotate, not edit
 *   7. B's /a/<id> is the SHELL with an edit button; sharing offers social preview and access controls
 *   8. B and the owner type into different paragraphs; both land, no reload
 *   9. B's dashboard names the document and their role
 *  10. demoted to `can view`, B's next flush is refused and a reload serves the plain document — no edit button
 *
 * Isolated in CI (CI_ISOLATED_GATES): its concurrent typing loses races under a neighbour's browser load.
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.
 *
 *   node scripts/gates/gate-collab-roles.mjs [base]
 */
import { mergeGuestIntoAccount } from '../lib/start-doc.mjs';
import { sleep } from './lib/sleep.mjs';
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentFrame, documentLocator, INLINE_STORY } from './lib/page-facts.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
/*
 * The role control is the HOUSE dropdown, not a native
 * <select>: an option list is drawn by the OS, which put system chrome in the
 * middle of the panel. So it is a trigger button naming the current value over
 * a listbox — read its TEXT, and pick by clicking an option.
 */
const roleTrigger = (page, email) => page.locator(`[aria-label="Role for ${email}"]`);
const pickRole = async (page, email, label) => {
  await roleTrigger(page, email).click();
  await page.locator('[role="option"]', { hasText: label }).click();
};
/** True once the row for `email` reads `label` (bounded), false if it never does. */
const roleReads = (page, email, label, budgetMs = 10000) =>
  roleTrigger(page, email).filter({ hasText: label }).waitFor({ state: 'attached', timeout: budgetMs }).then(() => true, () => false);
const check = createChecker('collab-roles');
const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_collab_owner_${stamp}@example.com`;
const EDITOR_EMAIL = `mxmx_test_collab_editor_${stamp}@example.com`;
const COMMENTER_EMAIL = `mxmx_test_collab_commenter_${stamp}@example.com`;
const STRANGER_EMAIL = `mxmx_test_link_stranger_${stamp}@example.com`;

async function until(read, want, budgetMs = 10000) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    last = await read().catch(() => undefined);
    if (want(last)) return last;
    await sleep(200);
  }
  return last;
}

const LINK_DOC = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-3xl">General access</h1>'
  + '<p id="claim">Anyone with this link may comment on it.</p>'
  + '</div>';

/** Every admitted role reads the same document in its frame; capabilities differ below. */
const hasDocument = async (page) => {
  const doc = await documentFrame(page).catch(() => null);
  if (!doc) return false;
  await doc.locator('#claim').waitFor({ timeout: 20000 }).catch(() => {});
  return (await doc.locator(INLINE_STORY).count()) === 1 && (await doc.locator('#claim').count()) === 1;
};

/*
 * Everything about a document lives behind ONE control (PageControls, in
 * solid/components/PageChrome), and that popover renders its children only while it
 * is OPEN. Two consequences for a gate, and the second is the dangerous one:
 * reaching for `[aria-label="Share"]` on a closed popover simply finds nothing,
 * while a `count() === 0` on a closed popover PASSES — for the wrong reason.
 * Every check below that reads what is inside opens it first.
 *
 * It is closed again before anything touches the frame: the open popover lays a
 * click-outside overlay across the whole viewport, which would swallow a click
 * meant for the document.
 *
 * The bar's own "Comment" button is drawn for every reader (it sends one who may
 * not comment to sign in), so "a comment control" here is the panel's
 * "Toggle comments", which only a commenter gets.
 */
const commentControls = async (page) => {
  await openControls(page);
  const n = await page.locator('[aria-label="Toggle comments"]').count();
  await closeControls(page);
  return n;
};
const CONTROLS = '[aria-label="Artifact controls"]';
const controlsOpen = (page) => page.locator(CONTROLS).isVisible().catch(() => false);
const openControls = async (page) => {
  if (await controlsOpen(page)) return;
  await openArtifactControls(page);
  await page.locator(CONTROLS).waitFor({ timeout: 15000 });
};
const closeControls = async (page) => {
  if (!(await controlsOpen(page))) return;
  await page.locator('[aria-label="Dismiss artifact controls"]').click();
  await page.locator(CONTROLS).waitFor({ state: 'hidden', timeout: 15000 });
};

const sink = await startMailSink();
const browser = await launchChromium();
const contextFor = () => browser.newContext({ viewport: { width: 1400, height: 950 } });
const [ownerCtx, editorCtx, commenterCtx, strangerCtx] = await Promise.all([contextFor(), contextFor(), contextFor(), contextFor()]);
const [owner, editor, commenter, stranger] = await Promise.all([ownerCtx, editorCtx, commenterCtx, strangerCtx].map((ctx) => ctx.newPage()));
const signedIn = async (ctx) => Boolean((await ctx.cookies(BASE)).find((c) => /better-auth/.test(c.name)));

// Four people sign in at once: the sink reads each code by its address, so parallel logins cannot cross.
await Promise.all([
  loginViaEmail(owner, BASE, sink, OWNER_EMAIL),
  loginViaEmail(editor, BASE, sink, EDITOR_EMAIL),
  loginViaEmail(commenter, BASE, sink, COMMENTER_EMAIL),
  loginViaEmail(stranger, BASE, sink, STRANGER_EMAIL),
]);
check(await signedIn(ownerCtx), 'owner logged in');
check(await signedIn(editorCtx), 'editor logged in');
check(await signedIn(commenterCtx), 'commenter logged in');
check(await signedIn(strangerCtx), 'a second person is signed in — and was never invited to anything');

// The owner's token: guest-owned, then adopted by the verified session.
const anon = await connectAgent(BASE, { email: OWNER_EMAIL });
const claimed = await mergeGuestIntoAccount(owner, BASE, anon.token);
check(claimed === 200, 'owner adopted the guest connection');
const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const [doc, linkDoc] = await Promise.all([
  api('/api/artifacts', {
    method: 'POST',
    body: JSON.stringify({ title: 'Collab gate', visibility: 'public', markup: '<div class="p-8"><h1>Collab gate</h1><p>First paragraph.</p><p>Second paragraph.</p></div>' }),
  }),
  api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'General access gate', visibility: 'public', markup: LINK_DOC }) }),
]);
check(doc.visibility === 'public', 'a PUBLIC document — the case that had no way to grant edit before');
check(!!linkDoc.id, `published a public document (${linkDoc.id})`);

const sharingPut = (page) => page.waitForResponse((r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200, { timeout: 15000 });

// ═════════ GENERAL ACCESS: the link carries a role ═════════
// ── 1. link = can view: the stranger is served the DOCUMENT ──────────────
await stranger.goto(`${BASE}/a/${linkDoc.id}`, { waitUntil: 'load' });
check(await hasDocument(stranger), 'link=can view: a signed-in stranger gets the framed document');
check((await commentControls(stranger)) === 0, '…and no comment control');

// ── 2. the owner flips ONE control ───────────────────────────────────────
await owner.goto(`${BASE}/a/${linkDoc.id}`, { waitUntil: 'load' });
const linkRole = owner.locator('[aria-label="Link role"]');
/*
 * IDEMPOTENT: the share button is a TOGGLE, so a blind second click closes
 * the popover it was meant to open. Escape does not help — inside the
 * popover that belongs to the dropdown, not to the panel.
 */
const openShare = async (page) => {
  if (await linkRole.isVisible().catch(() => false)) return;
  await openControls(page);
  await page.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
  await linkRole.waitFor({ timeout: 15000 });
};
await openShare(owner);
check((await linkRole.textContent() ?? '').includes('can view'), 'general access starts at can view');
await Promise.all([
  sharingPut(owner),
  (async () => {
    await linkRole.click();
    await owner.locator('[role="option"]', { hasText: 'can comment' }).click();
  })(),
]);
check(
  (await until(() => linkRole.textContent(), (t) => (t ?? '').includes('can comment'))) !== undefined
    && ((await linkRole.textContent()) ?? '').includes('can comment'),
  'the owner set the link to can comment',
);
// ── 2b. the SAME link, reloaded: now the shell ────────────────────────────
await stranger.reload({ waitUntil: 'load' });
check(await hasDocument(stranger), 'link=can comment: the same framed document remains available');
// Inside the open popover, so the two absences below are real absences.
await openControls(stranger);
check((await stranger.locator('[aria-label="Toggle comments"]').count()) === 1, '…with the comments control');
check((await stranger.locator('[aria-label="Edit artifact"]').count()) === 0, '…and NO edit button — a commenter is not an editor');
check((await stranger.getByLabel('Document actions').getByLabel('Share', { exact: true }).count()) === 0
  && await stranger.getByLabel('Owner actions').count() === 0, '…and no permissions-sharing control: the ACL stays the owner\'s');
await closeControls(stranger);

// ── 2c. …on the framed document ───────────────────────────────────────────
check(await stranger.locator(INLINE_STORY).count() === 0 && await documentLocator(stranger).locator(INLINE_STORY).count() === 1,
  'commenting uses the one framed document, not a second runtime on the app page');

// ── 3. they comment, from selection to saved thread ──────────────────────
// The selection and its action bubble live in the document's frame; the composer is the app page's.
const frame = documentLocator(stranger);
await frame.locator('#claim').waitFor({ timeout: 15000 });
const bubble = frame.locator('[data-mx-selection-actions]');
await until(async () => {
  await frame.locator('#claim').click({ clickCount: 3, timeout: 2000 }).catch(() => {});
  return bubble.isVisible().catch(() => false);
}, (v) => v === true, 20000);
check(await bubble.isVisible(), 'selecting words offers the stranger the action bubble');
check((await frame.locator('[aria-label="Edit selected text"]').count()) === 0,
  'the bubble offers annotate and NOT edit — the capability follows the role');

await frame.locator('[aria-label="Comment on selected text"]').click();
const composer = await until(() => stranger.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
check(composer === 1, 'the composer opens on those words');
await stranger.locator('[aria-label="Annotation comment"]').fill('a stranger with the link, saying something');
await stranger.locator('[aria-label="Save annotation"]').click();
const saved = await until(
  () => fetch(`${BASE}/api/artifacts/${linkDoc.id}/annotations`, { headers: { Authorization: `Bearer ${anon.token}` } })
    .then((r) => r.json()).then((j) => j.annotations?.length ?? 0),
  (n) => n === 1, 15000,
);
check(saved === 1, 'the comment is stored — a person nobody invited left feedback');

// ── 3b. the owner never reloaded ──────────────────────────────────────────
// The count rides the app bar's Comment button (solid/document/DocumentChrome), kept live by the page's stream.
const ownerComment = owner.locator('header[aria-label="Page bar"] [aria-label="Comment"]');
const live = await until(async () => ((await ownerComment.textContent()) ?? '').trim(), (t) => t === '1', 20000);
check(live === '1', 'the owner watches the count arrive over the live stream — no reload');

// ── 4. logged OUT on the same link: the anonymous ceiling ────────────────
const anonCtx = await contextFor();
const visitor = await anonCtx.newPage();
await visitor.goto(`${BASE}/a/${linkDoc.id}`, { waitUntil: 'load' });
check(await hasDocument(visitor), 'logged out on a link-commentable document: the framed document — anonymous caps at viewer');
check((await commentControls(visitor)) === 0, '…and no comment control, so the crawler path is untouched');

// ── 5. flipped back, the stranger loses it ───────────────────────────────
await openShare(owner);
await Promise.all([
  sharingPut(owner),
  (async () => {
    await linkRole.click();
    await owner.locator('[role="option"]', { hasText: 'can view' }).click();
  })(),
]);
await stranger.reload({ waitUntil: 'load' });
check(await hasDocument(stranger), 'demoted to can view: the framed document remains readable');
check((await commentControls(stranger)) === 0, '…and the comment control is gone');
await anonCtx.close();

// ═════════ NAMED PEOPLE: a share carries a role ═════════
// ── 6. invite + promote from the share menu ──────────────────────────────
await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await openArtifactControls(owner);
await owner.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
await owner.waitForSelector('[aria-label="Invite email"]', { timeout: 15000 });
check(true, 'the people list is offered on a public document');
await owner.fill('[aria-label="Invite email"]', EDITOR_EMAIL);
await Promise.all([sharingPut(owner), owner.click('[aria-label="Add email"]')]);
await roleTrigger(owner, EDITOR_EMAIL).waitFor({ timeout: 15000 });
check((await roleTrigger(owner, EDITOR_EMAIL).textContent() ?? '').includes('can view'), 'a new person starts as a viewer');
await Promise.all([sharingPut(owner), pickRole(owner, EDITOR_EMAIL, 'can edit')]);
// The select is CONTROLLED by the server's answer: the response is seen here
// before the component has parsed it and re-rendered, so wait for the DOM.
check(await roleReads(owner, EDITOR_EMAIL, 'can edit'), 'promoted to can edit from the row');

// ── 6b. a COMMENTER: may annotate, may not edit — from a real logged-in browser ──
await owner.fill('[aria-label="Invite email"]', COMMENTER_EMAIL);
await Promise.all([sharingPut(owner), owner.click('[aria-label="Add email"]')]);
await roleTrigger(owner, COMMENTER_EMAIL).waitFor({ timeout: 15000 });
await Promise.all([sharingPut(owner), pickRole(owner, COMMENTER_EMAIL, 'can comment')]);
check(await roleReads(owner, COMMENTER_EMAIL, 'can comment'), 'promoted to can comment from the row');
await commenter.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await openArtifactControls(commenter);
check((await commenter.locator('[aria-label="Edit artifact"]').count()) === 0, 'the commenter sees no edit button');
const head = await api(`/api/artifacts/${doc.id}`);
const annotated = await commenter.evaluate(async ({ id, editId }) => {
  const r = await fetch(`/api/my/artifacts/${id}/annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '0', edit_id: editId, body: 'a comment from the commenter' }) });
  return r.status;
}, { id: doc.id, editId: head.edit_id });
check(annotated === 201, `the commenter may open a thread from the browser (${annotated})`);
// "…and may not edit — the uniform 404" (a commenter's POST /edits) is a pure HTTP fact, asserted against the real
// handlers in services/app/__tests__/collab-commenters.test.ts ("may NOT edit, replace, or delete") and
// collab-editors.test.ts (a viewer's /api/my edits 404).
await commenterCtx.close();

// ── 7. the editor gets the SHELL, with edit and without the owner's controls ──
await editor.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await openArtifactControls(editor);
const editBtn = editor.locator('[aria-label="Edit artifact"]');
check((await editBtn.count()) === 1, 'the editor sees the edit button (the shell, not the served document)');
// Editors manage sharing and social preview through the same dialog.
await editor.getByLabel('Document actions').getByLabel('Share', { exact: true }).click();
await editor.locator('[role="dialog"][aria-label="Sharing"]').waitFor();
check((await editor.locator('[aria-label="Edit social preview"]').count()) === 1, 'the editor can configure social preview from sharing');
await editor.getByLabel('Invite email').waitFor();
check((await editor.locator('[aria-label="Make public"]').count()) === 1, 'sharing exposes access controls to the editor');
const sharingAttempt = await editor.evaluate(async ({ id }) => {
  const r = await fetch(`/api/my/artifacts/${id}/sharing`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'public' }),
  });
  return r.status;
}, { id: doc.id });
check(sharingAttempt === 200, `the editor can change sharing permissions (${sharingAttempt})`);
await editor.click('[aria-label="Close sharing"]');

// ── 8. both edit, different paragraphs, no reload ─────────────────────────
// The document is framed by the app page on its own origin: its paragraphs are in that frame.
const frameOf = (page) => documentFrame(page);
/*
 * Edit mode is LIVE once the frame carries an editing host — the runtime loads its edit chunk on demand, so the
 * document is drawn a beat before anything in it listens. Polled for (it was a fixed six-second sleep), then a short
 * settle for the live stream the editor reconciles through.
 */
const editorLive = async (page) => {
  const f = await frameOf(page);
  await f.locator('[contenteditable="true"]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return f;
};
const openEditor = async (page) => {
  await page.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
  const f = await editorLive(page);
  check(!!f && (await f.locator('p').count()) >= 2, `${page === owner ? 'owner' : 'editor'}: the in-place editor is up`);
};
await Promise.all([openEditor(editor), openEditor(owner)]);

// Focus a host with a caret at its end — the way gate-inplace-edit does it,
// because a CLICK lands under the typography toolbar that floats over the
// document while a host is focused, and the engine commits text on BLUR, so
// moving focus to another host is what commits.
const focusHost = async (page, nth) => (await frameOf(page)).evaluate((n) => {
  const el = document.querySelectorAll('p')[n];
  // The editing host takes focus (and with it the frame, so the keyboard reaches it), not the paragraph in it.
  (el.closest('[contenteditable="true"]') ?? el).focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}, nth);
await focusHost(editor, 1);
await editor.keyboard.type(' Added by the editor.');
await focusHost(editor, 0); // blur commits
await focusHost(owner, 0);
await owner.keyboard.type(' Added by the owner.');
await focusHost(owner, 1);
await owner.waitForTimeout(3500);
await editor.waitForTimeout(500);

const stored = await api(`/api/artifacts/${doc.id}`);
check(stored.markup.includes('Added by the editor.'), "the editor's paragraph reached the server");
check(stored.markup.includes('Added by the owner.'), "the owner's paragraph reached the server");
const editorSees = await (await frameOf(editor)).locator('body').innerText();
check(/Added by the owner\./.test(editorSees) && /Added by the editor\./.test(editorSees), 'the editor\'s open document shows BOTH edits, live');

// ── 9. the editor's dashboard names it and their role ─────────────────────
await editor.goto(`${BASE}/`, { waitUntil: 'load' });
// The dashboard's data arrives from /api/page/home, so wait for the row rather
// than reading the DOM in the same breath as the navigation.
const roleCell = editor.locator(`[aria-label="Your role on ${doc.id}"]`);
await roleCell.waitFor({ timeout: 20000 }).catch(() => {});
check((await roleCell.count()) === 1 && (await roleCell.textContent()) === 'can edit', 'shared-with-you lists the document as can edit');

// ── 10. demotion takes effect on the next write ────────────────────────────
await editor.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
await editorLive(editor);
await Promise.all([sharingPut(owner), (async () => {
  await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await openArtifactControls(owner);
  await owner.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
  await roleTrigger(owner, EDITOR_EMAIL).waitFor({ timeout: 15000 });
  await pickRole(owner, EDITOR_EMAIL, 'can view');
})()]);

const refused = editor.waitForResponse((r) => r.url().includes('/edits') && r.request().method() === 'POST' && r.status() === 404, { timeout: 15000 });
await focusHost(editor, 1);
await editor.keyboard.type(' After demotion.');
await focusHost(editor, 0);
check(Boolean(await refused.catch(() => null)), 'the demoted editor\'s next flush is refused (uniform 404)');
const after = await api(`/api/artifacts/${doc.id}`);
check(!after.markup.includes('After demotion.'), 'nothing of it was stored');

await editor.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
check((await editor.locator('[aria-label="Edit artifact"]').count()) === 0, 'reloaded, the viewer gets the served document — no edit button');

await browser.close();
await sink.close();
check.done();
