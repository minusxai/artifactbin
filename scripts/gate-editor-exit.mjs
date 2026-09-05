/**
 * Gate: pressing `done` must not throw away what was just typed.
 *
 * The fault this pins: the editor saves on a 500ms debounce and `done`
 * called onExit directly, which unmounts the editor — and the unmount runs the
 * debounce effect's cleanup, cancelling the save. Typing and leaving inside
 * half a second sent NOTHING (measured: zero requests to /edits), while the
 * status chip still read `saved`. Every unit test in the suite passed through
 * this, because in jsdom nothing unmounts unless a test says so.
 *
 * So the property is deliberately end-to-end and timing-shaped, and every WAY
 * OUT is checked separately — done, the back button, a hidden tab — since each
 * leaves through a different path and any of them can regress
 * alone. The PAIR of cases is the evidence — same clicks, only the pause
 * differs — because "it saved" with a pause proves the save path works and
 * isolates the exit as the thing that lost it.
 *
 *   usage: node scripts/gate-editor-exit.mjs [base]
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
// Printed as they happen, not only at the end: a gate that dies mid-run must
// still show what it had already proved.
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

const MARKUP_DOC = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Original heading</h1>'
  + '<p className="mt-4 text-lg">Body copy.</p></div>';

/** A fresh document, plus the token that owns it. */
async function mint(fields) {
  // The token rides the start LINK now (lib/agent-session). startDocument
  // throws rather than walking on: anonymous minting is per-IP rate limited,
  // and a gate that walked on edited /a/undefined and reported a loss that was
  // not real.
  const st = await startDocument(B);
  await fetch(`${B}/api/artifacts/${st.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    body: JSON.stringify({ title: 'exit gate', ...fields }),
  });
  return st;
}

const read = async (st) => (await fetch(`${B}/api/artifacts/${st.id}`, {
  headers: { Authorization: `Bearer ${st.token}` },
})).json();

const browser = await chromium.launch();

/**
 * Open the document, type into its heading, wait `pause` ms, press done.
 * Returns what the SERVER has afterwards — the only thing that survives a tab.
 */
async function typeAndLeave({ pause, stamp, leaveBy = 'done' }) {
  const st = await mint({ markup: MARKUP_DOC, theme: 'manuscript' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const posts = [];
  page.on('request', (r) => { if (r.url().includes('/edits')) posts.push(r.url()); });

  // The token goes in BEFORE the first navigation: loading the page once to
  // seed localStorage and then hopping to `#edit` is a same-document fragment
  // navigation, which is not how anyone reaches edit mode and races hydration
  // in a way that has nothing to do with what this gate measures.
  // A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(page, B, st.token);
  if (leaveBy === 'back') {
    // Enter the way a person does, so the history entry that back undoes is
    // the one the page pushed. A deep link to #edit has nothing to go back to.
    await page.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
    // The owner rail is decided client-side for a token owner (ArtifactShell
    // asks /api/artifacts), so the edit control appears a beat after load —
    // a fixed pause is a flake on a cold dev server.
    await openArtifactControls(page);
    await page.locator('[aria-label="Edit artifact"]')
      .first().click({ timeout: 30_000 });
  } else {
    await page.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'load' });
  }
  // Generous: in dev the story-editor bundle is compiled on FIRST use, and a
  // cold compile is slower than any interaction this gate measures.
  await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
  // The canvas mounts after the editor bar; typing before it exists types into
  // nothing and the gate then reports a loss that never happened.
  await page.waitForTimeout(3000);

  /*
   * Reached through the FRAME, not through `contentDocument`.
   *
   * Editing happens in the served document now, which is sandboxed without
   * allow-same-origin — so it is opaque to the page and `contentDocument` is
   * null. Playwright can address it directly; the page never could, which is
   * the whole security property.
   */
  const documentFrame = () => page.frames().find((f) => /\/raw/.test(f.url()));
  await page.waitForFunction(() => {
    // The runtime loads its edit chunk on demand; a caret exists only after.
    const f = [...document.querySelectorAll('iframe')].find((el) => /\/raw/.test(el.src));
    return !!f;
  }, null, { timeout: 60_000 });
  const frame = documentFrame();
  await frame.waitForFunction(() => !!document.querySelector('h1')?.isContentEditable, null, { timeout: 60_000 });
  await frame.evaluate(() => {
    const h = document.querySelector('h1');
    h.focus();
    const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.type(stamp);

  // The typing must be IN THE DOCUMENT before we leave, or this measures
  // nothing — a gate that types into something not ready reports a loss that
  // never happened, which is worse than no gate at all.
  const inDocument = await documentFrame().evaluate(() => document.querySelector('h1')?.textContent ?? '');
  if (!inDocument.includes(stamp.trim())) {
    console.error(`could not type into the document (heading reads ${JSON.stringify(inDocument)}) — `
      + 'this is a gate setup failure, not a data-loss finding.');
    process.exit(2);
  }

  if (pause) await page.waitForTimeout(pause);
  if (leaveBy === 'done') {
    await page.click('[aria-label="Exit edit mode"]');
    // Far longer than the debounce, so a save that was merely SLOW still counts
    // as saved — only one that never left the browser fails here.
    await page.waitForTimeout(5000);
  } else if (leaveBy === 'back') {
    // The browser's own back button. It never touches the done handler: the
    // page hears a hashchange and unmounts the editor, debounce and all.
    await page.goBack();
    await page.waitForTimeout(5000);
  } else {
    // The tab going away: same loss, no click to hang the save on.
    //
    // Then LEAVE, inside the debounce window. Without the navigation the
    // debounce lands a few hundred ms later and the document is saved either
    // way — which is why this case passed against the broken editor. The wait
    // is capped BELOW the debounce (500ms) on purpose: past it, the timer
    // itself would be what saved the document and the check proves nothing.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForResponse((r) => r.url().includes('/edits'), { timeout: 400 }).catch(() => {});
    await page.goto('about:blank');
    await page.waitForTimeout(1500);
  }

  const row = await read(st);
  await page.close();
  const doc = row.markup ?? '';
  return { saved: doc.includes(stamp.trim()), version: row.version, posts: posts.length, id: st.id };
}

/**
 * One document format means one editor — so every WAY OUT is exercised against
 * it, which is what this gate was always really about (the html tier's
 * duplicate cases retired with the tier).
 */

// ── 1. the pause: typing, then waiting for the debounce ────────────────────
const paused = await typeAndLeave({ pause: 2500, stamp: ' PAUSED' });
ok(paused.saved, `typing then waiting saves (v${paused.version}, ${paused.posts} POST)`);

// ── 2. no pause at all: done pressed in the same breath as the edit ────────
const fast = await typeAndLeave({ pause: 0, stamp: ' FAST' });
ok(fast.saved, `typing then pressing done AT ONCE saves (v${fast.version}, ${fast.posts} POST)`);
ok(fast.posts > 0, 'and `done` actually sent something (0 requests was the bug)');

// ── 3. the back button: leaves edit mode without pressing anything ─────────
const back = await typeAndLeave({ pause: 0, stamp: ' BACK', leaveBy: 'back' });
ok(back.saved, `the browser back button saves too (v${back.version}, ${back.posts} POST)`);

// ── 4. the other way out: the tab, with nothing to click ───────────────────
const hidden = await typeAndLeave({ pause: 0, stamp: ' HIDDEN', leaveBy: 'hide' });
ok(hidden.saved, `a hidden tab drains too (v${hidden.version}, ${hidden.posts} POST)`);

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
