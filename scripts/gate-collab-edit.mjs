/**
 * Gate: multi-user editing, in a real browser, end to end.
 *
 * The vitest suite proves the role decisions in-process; what only a browser
 * can prove is the delivery seam: that a named EDITOR — not the owner — is
 * handed the page (not the served document), sees the edit affordance and
 * none of the owner's, edits IN PLACE while the owner edits another paragraph
 * of the same document, and loses all of it the moment the owner demotes them.
 *
 *   1. owner invites B from the share menu and promotes them to `can edit`
 *   2. B's /a/<id> is the SHELL with an edit button; the sharing dialog is not theirs
 *   3. B and the owner type into different paragraphs; both land, no reload
 *   4. B's dashboard names the document and their role
 *   5. demoted to `can view`, B's next flush is refused and a reload serves
 *      the plain document — no edit button
 *
 * Two logged-in contexts, one mail sink. usage:
 *   EMAIL__RESEND_API_KEY=x EMAIL__RESEND_BASE_URL=http://127.0.0.1:4612 npm run dev
 *   node scripts/gate-collab-edit.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';

const SINK_PORT = 4612;
const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
/*
 * The role control is the HOUSE dropdown (components/SelectMenu), not a native
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
  page.waitForFunction(([sel, want]) => (document.querySelector(`[aria-label="${sel}"]`)?.textContent ?? '').includes(want), [`Role for ${email}`, label], { timeout: budgetMs }).then(() => true, () => false);
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_collab_owner_${stamp}@example.com`;
const EDITOR_EMAIL = `mxmx_test_collab_editor_${stamp}@example.com`;
const COMMENTER_EMAIL = `mxmx_test_collab_commenter_${stamp}@example.com`;

const sink = await startMailSink(SINK_PORT);
const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const editorCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
const editor = await editorCtx.newPage();

await loginViaEmail(owner, BASE, sink, OWNER_EMAIL);
check(Boolean((await ownerCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'owner logged in');
await loginViaEmail(editor, BASE, sink, EDITOR_EMAIL);
check(Boolean((await editorCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'editor logged in');

// The owner's token: minted anonymously, claimed by the session.
const anon = await (await fetch(`${BASE}/api/tokens/anonymous`, { method: 'POST' })).json();
const claimed = await owner.evaluate(async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status, anon.token);
check(claimed === 200, 'owner claimed the token');
const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const doc = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'Collab gate', visibility: 'public', markup: '<div class="p-8"><h1>Collab gate</h1><p>First paragraph.</p><p>Second paragraph.</p></div>' }),
});
check(doc.visibility === 'public', 'a PUBLIC document — the case that had no way to grant edit before');

// ── 1. invite + promote from the share menu ──────────────────────────────
const sharingPut = (page) => page.waitForResponse((r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200, { timeout: 15000 });
await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await owner.locator('[aria-label="Open artifact controls"]').click();
await owner.locator('[aria-label="Share"]').first().click();
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

// ── 1b. a COMMENTER: may annotate, may not edit — from a real logged-in browser ──
const commenterCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const commenter = await commenterCtx.newPage();
await loginViaEmail(commenter, BASE, sink, COMMENTER_EMAIL);
check(Boolean((await commenterCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'commenter logged in');
await owner.fill('[aria-label="Invite email"]', COMMENTER_EMAIL);
await Promise.all([sharingPut(owner), owner.click('[aria-label="Add email"]')]);
await roleTrigger(owner, COMMENTER_EMAIL).waitFor({ timeout: 15000 });
await Promise.all([sharingPut(owner), pickRole(owner, COMMENTER_EMAIL, 'can comment')]);
check(await roleReads(owner, COMMENTER_EMAIL, 'can comment'), 'promoted to can comment from the row');
await commenter.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await commenter.locator('[aria-label="Open artifact controls"]').click();
check((await commenter.locator('[aria-label="Edit artifact"]').count()) === 0, 'the commenter sees no edit button');
const head = await api(`/api/artifacts/${doc.id}`);
const annotated = await commenter.evaluate(async ({ id, editId }) => {
  const r = await fetch(`/api/my/artifacts/${id}/annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '0', edit_id: editId, body: 'a comment from the commenter' }) });
  return r.status;
}, { id: doc.id, editId: head.edit_id });
check(annotated === 201, `the commenter may open a thread from the browser (${annotated})`);
const editAttempt = await commenter.evaluate(async ({ id }) => {
  const h = await (await fetch(`/api/artifacts/${id}`)).json().catch(() => ({}));
  const r = await fetch(`/api/my/artifacts/${id}/edits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit_id: h.edit_id ?? 'x', source: '<div><p>nope</p></div>' }) });
  return r.status;
}, { id: doc.id });
check(editAttempt === 404, `…and may not edit — the uniform 404 (${editAttempt})`);
await commenterCtx.close();

// ── 2. the editor gets the SHELL, with edit and without the owner's controls ──
await editor.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await editor.locator('[aria-label="Open artifact controls"]').click();
const editBtn = editor.locator('[aria-label="Edit artifact"]');
check((await editBtn.count()) === 1, 'the editor sees the edit button (the shell, not the served document)');
// The ACL is the owner's: an editor's shell carries no share control at all.
check((await editor.locator('[aria-label="Share"]').count()) === 0 && (await editor.locator('[aria-label="Make public"]').count()) === 0, 'the share menu (the ACL) is not the editor\'s');

// ── 3. both edit, different paragraphs, no reload ─────────────────────────
const frameOf = (page) => page.frames().find((f) => f !== page.mainFrame());
const openEditor = async (page) => {
  await page.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
  await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
  const f = () => frameOf(page);
  await page.waitForTimeout(6000);
  check(!!f() && (await f().locator('p').count()) >= 2, `${page === owner ? 'owner' : 'editor'}: the in-place editor is up`);
};
await openEditor(editor);
await openEditor(owner);

// Focus a host with a caret at its end — the way gate-inplace-edit does it,
// because a CLICK lands under the typography toolbar that floats over the
// document while a host is focused, and the engine commits text on BLUR, so
// moving focus to another host is what commits.
const focusHost = (page, nth) => frameOf(page).evaluate((n) => {
  const el = document.querySelectorAll('p')[n];
  el.focus();
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
const editorSees = await frameOf(editor).locator('body').innerText();
check(/Added by the owner\./.test(editorSees) && /Added by the editor\./.test(editorSees), 'the editor\'s open document shows BOTH edits, live');

// ── 4. the editor's dashboard names it and their role ─────────────────────
await editor.goto(`${BASE}/`, { waitUntil: 'load' });
// The dashboard's data arrives from /api/page/home, so wait for the row rather
// than reading the DOM in the same breath as the navigation.
const roleCell = editor.locator(`[aria-label="Your role on ${doc.id}"]`);
await roleCell.waitFor({ timeout: 20000 }).catch(() => {});
check((await roleCell.count()) === 1 && (await roleCell.textContent()) === 'can edit', 'shared-with-you lists the document as can edit');

// ── 5. demotion takes effect on the next write ────────────────────────────
await editor.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
await editor.waitForTimeout(6000);
await Promise.all([sharingPut(owner), (async () => {
  await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await owner.locator('[aria-label="Open artifact controls"]').click();
  await owner.locator('[aria-label="Share"]').first().click();
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
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall good');
