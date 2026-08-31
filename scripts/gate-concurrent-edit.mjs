/**
 * Gate: a human typing and an agent editing AT THE SAME TIME.
 *
 * The headline promise of the concurrent-edit protocol is that two people
 * working on different parts of a document never destroy each other's work.
 * The dangerous window is the one this gate drives: text the human has typed
 * but NOT yet committed (the engine commits on blur), while a remote change
 * lands over the live stream. Adopting the remote document then would remount
 * the canvas and silently discard what they were typing.
 *
 * jsdom cannot model same-origin iframe focus/blur, so this has to be a real
 * browser.  usage: node scripts/gate-concurrent-edit.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const api = async (path, init = {}, token) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// The user's entry point: one call gives a live document and its capability.
// The token rides the start LINK now, not the response body (lib/agent-session).
const start = await startDocument(BASE);
const token = start.token;
const read = () => api(`/api/artifacts/${start.id}`, {}, token);

const browser = await chromium.launch();
const page = await browser.newPage();
// The human here is the document's OWNER: they get the shell (and the editor).
// Ownership is the httpOnly session cookie now, not a localStorage token.
await becomeOwner(page, BASE, token);

// Seed a document with clearly separate nodes to work in — BEFORE any
// navigation to it. A whole-document PUT rather than an /edits splice: the
// placeholder /api/start writes carries its own classNames, so pinning its
// exact text here just re-breaks this gate every time that copy is restyled.
// Seeding first is load-bearing: `/a/<id>#edit` differs from `/a/<id>` only by
// a hash, so the browser would treat a later visit as a client-side hash
// change with no re-render, and the editor would seed the stale placeholder.
await api(`/api/artifacts/${start.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    // The h1 is the BLUR TARGET further down (the engine commits on blur), not decoration.
    markup: '<div className="p-8"><h1>Concurrent edit gate</h1><p>First paragraph.</p><p>Second paragraph.</p></div>',
  }),
}, token);

await page.goto(`${BASE}/a/${start.id}#edit`, { waitUntil: 'load' });
check((await page.locator('[aria-label="Save"]').count()) === 0, 'the editor has no Save button');
const surface = () => page.frames().find((f) => f !== page.mainFrame());
// Wait for the CANVAS to populate rather than a fixed pause: the editor now
// runs the document's dataflow (DuckDB) on load, so the paragraphs land later
// than a flat timeout assumed.
// Wait for the canvas to POPULATE, then let it settle: the editor now runs the
// document's dataflow on load and remounts the canvas once when it completes,
// so a click during that window hits a detached frame (verified: stable by ~8s).
await page.waitForFunction(() => {
  const f = Array.from(document.querySelectorAll('iframe')).map((i) => i.contentDocument).find(Boolean);
  return (f?.querySelectorAll('p').length ?? 0) >= 2;
}, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(6000);
check(!!surface(), 'story surface mounted');

// ── The dangerous window: type WITHOUT committing, then let a remote edit land ──
await surface().locator('p').nth(1).click();
await page.keyboard.type(' Typed by the human.');
const typedVisible = await surface().locator('body').innerText();
check(/Typed by the human\./.test(typedVisible), 'the typing is in the editor DOM');

// The agent edits a DIFFERENT node while that text is still uncommitted.
const head = await read();
const agentResult = await api(`/api/artifacts/${start.id}/edits`, {
  method: 'POST',
  body: JSON.stringify({ edit_id: head.edit_id, old_string: 'First paragraph.', new_string: 'First paragraph, revised by the agent.' }),
}, token);
check(agentResult.markup.includes('revised by the agent'), 'the agent edit applied server-side');

// Give the live stream time to deliver it while the human is still typing.
await page.waitForTimeout(2500);
const duringTyping = await surface().locator('body').innerText();
check(/Typed by the human\./.test(duringTyping), 'uncommitted typing SURVIVES a remote edit arriving');

// Now commit (blur) and let the buffer drain.
await surface().locator('h1').first().click();
await page.waitForTimeout(3000);

const stored = await read();
check(stored.markup.includes('Typed by the human.'), "the human's text reached the server");
check(stored.markup.includes('revised by the agent'), "the agent's text is still there");
check(/Typed by the human\./.test(await surface().locator('body').innerText()), 'the editor still shows the human text');

// ── Entering edit mode AFTER watching live updates must not rewind ──
// A reader can watch an agent write for minutes before pressing edit; the
// editor has to open on what they are looking at, not on what the page was
// server-rendered with.
{
  const viewer = await browser.newPage();
  // Pressing edit is an OWNER affordance, so this browser holds the document's
  // token — as the httpOnly session cookie, which is where a browser keeps one
  // now. (newPage opens a fresh context, so it owns nothing until it does.)
  await becomeOwner(viewer, BASE, token);
  await viewer.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  await viewer.waitForTimeout(2500);

  const head3 = await read();
  await api(`/api/artifacts/${start.id}/edits`, {
    method: 'POST',
    // Append, so the later check can still anchor on the original text.
    body: JSON.stringify({ edit_id: head3.edit_id, old_string: 'Second paragraph.', new_string: 'Second paragraph. Written while watching.' }),
  }, token);
  await viewer.waitForTimeout(3000);

  const watched = await viewer.frames().find((f) => f !== viewer.mainFrame())?.locator('body').innerText();
  check(/Written while watching/.test(watched ?? ''), 'the viewer saw the live edit');

  // Reading is chromeless until the artifact controls are opened.
  await viewer.click('[aria-label="Open artifact controls"]');
  await viewer.click('[aria-label="Edit artifact"]');
  await viewer.waitForTimeout(4000);
  const inEditor = await viewer.frames().find((f) => f !== viewer.mainFrame())?.locator('body').innerText();
  check(/Written while watching/.test(inEditor ?? ''), 'the editor opens on the LIVE document, not the page it was rendered with');
  // This used to read the editor's version chip; the save-less editor has none.
  // Same intent, anchored on the server: the document is on a real, advanced
  // version and the editor is showing THAT, not a rewound render.
  const headNow = await read();
  check(headNow.version >= 2, `the document is on a real, advanced version (v${headNow.version})`);
  check(headNow.markup.includes('Written while watching'), 'and the server holds what the editor is showing');
  await viewer.close();
}

// ── The reverse order: a remote edit while the editor sits idle ──
const head2 = await read();
await api(`/api/artifacts/${start.id}/edits`, {
  method: 'POST',
  body: JSON.stringify({ edit_id: head2.edit_id, old_string: 'Second paragraph.', new_string: 'Second paragraph, also agent-touched.' }),
}, token);
await page.waitForTimeout(3000);
check(/also agent-touched/.test(await surface().locator('body').innerText()), 'an idle editor adopts a remote edit live');

await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('\nall concurrent-edit gates passed');
