import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/**
 * EVERY WAY OUT OF THE EDITOR — split out of gate-editor-v2.mjs (its section 5) so no gate shard
 * waits on one two-minute script.
 *
 *   usage: node scripts/gates/gate-editor-exits.mjs [base]
 */
import { launchChromium } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const check = createChecker('editor-exits');
/** A step whose failure invalidates every step after it: report it, then stop. */
const must = (condition, label) => { if (!check(condition, label)) throw new Error(label); };
const base = process.argv[2] ?? 'http://localhost:3030';
const browser = await launchChromium();
try {
  /* ── 5. EVERY WAY OUT ─────────────────────────────────────────────────────
   *
   * The fault this pins: the editor saves on a 500 ms debounce and `done`
   * called onExit directly, which unmounts the editor — and the unmount runs
   * the debounce effect's cleanup, cancelling the save. Typing and leaving
   * inside half a second sent NOTHING (measured: zero requests to /edits) while
   * the status chip still read `saved`. Every unit test passed through it,
   * because in jsdom nothing unmounts unless a test says so.
   *
   * So each way out is exercised separately — done, the back button, a hidden
   * tab — and the PAIR of `done` cases is the evidence: same clicks, only the
   * pause differs, so "it saved with a pause" proves the save path works and
   * isolates the exit as the thing that lost it.
   */
  {
    const EXIT_DOC = '<div data-design="tw" className="p-10">'
      + '<h1 className="text-4xl font-bold">Original heading</h1>'
      + '<p className="mt-4 text-lg">Body copy.</p></div>';

    async function typeAndLeave({ pause, stamp, leaveBy = 'done' }) {
      const st = await startDocument(base);
      await fetch(`${base}/api/artifacts/${st.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
        body: JSON.stringify({ title: 'exit gate', markup: EXIT_DOC, theme: 'manuscript' }),
      });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const posts = [];
      page.on('request', (r) => { if (r.url().includes('/edits')) posts.push(r.url()); });
      await becomeOwner(page, base, st.token);
      if (leaveBy === 'back') {
        // Enter the way a person does, so the history entry `back` undoes is
        // the one the page pushed. A deep link to #edit has nothing to go back to.
        await page.goto(`${base}/a/${st.id}`, { waitUntil: 'load' });
        // Reading is chromeless until the artifact controls are revealed, and
        // the owner rail is decided client-side, so the control appears a beat
        // after load — a fixed pause here is a flake on a cold server.
        await openArtifactControls(page);
        await page.locator('[aria-label="Edit artifact"]').first().click({ timeout: 30_000 });
      } else {
        await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
      }
      await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
      // The canvas mounts after the editor bar; typing before it exists types
      // into nothing and would report a loss that never happened.
      await page.waitForTimeout(3000);
      const frame = page.mainFrame();
      await frame.waitForFunction(() => !!document.querySelector('h1')?.isContentEditable, null, { timeout: 60_000 });
      await frame.evaluate(() => {
        const h = document.querySelector('h1');
        h.focus();
        const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await page.keyboard.type(stamp);
      const inDocument = await page.mainFrame().evaluate(() => document.querySelector('h1')?.textContent ?? '');
      must(inDocument.includes(stamp.trim()),
        `the ${leaveBy} case could type into the document (heading reads ${JSON.stringify(inDocument)})`);

      if (pause) await page.waitForTimeout(pause);
      if (leaveBy === 'done') {
        await page.click('[aria-label="Exit edit mode"]');
        // Far longer than the debounce, so a merely SLOW save still counts as
        // saved — only one that never left the browser fails here.
        await page.waitForTimeout(5000);
      } else if (leaveBy === 'back') {
        // The browser's own back button. It never touches the done handler: the
        // page hears a hashchange and unmounts the editor, debounce and all.
        await page.goBack();
        await page.waitForTimeout(5000);
      } else {
        /*
         * The tab going away: same loss, no click to hang the save on. The wait
         * is capped BELOW the debounce (500ms) on purpose — past it, the timer
         * itself would be what saved the document.
         */
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForResponse((r) => r.url().includes('/edits'), { timeout: 400 }).catch(() => {});
        await page.goto('about:blank');
        await page.waitForTimeout(1500);
      }

      const row = await (await fetch(`${base}/api/artifacts/${st.id}`, {
        headers: { Authorization: `Bearer ${st.token}` },
      })).json();
      await page.close();
      return { saved: (row.markup ?? '').includes(stamp.trim()), version: row.version, posts: posts.length };
    }

    const paused = await typeAndLeave({ pause: 2500, stamp: ' PAUSED' });
    check(paused.saved, `typing then waiting saves (v${paused.version}, ${paused.posts} POST)`);
    const fast = await typeAndLeave({ pause: 0, stamp: ' FAST' });
    check(fast.saved, `typing then pressing done AT ONCE saves (v${fast.version}, ${fast.posts} POST)`);
    check(fast.posts > 0, 'and `done` actually sent something (0 requests was the bug)');
    const back = await typeAndLeave({ pause: 0, stamp: ' BACK', leaveBy: 'back' });
    check(back.saved, `the browser back button saves too (v${back.version}, ${back.posts} POST)`);
    const hidden = await typeAndLeave({ pause: 0, stamp: ' HIDDEN', leaveBy: 'hide' });
    check(hidden.saved, `a hidden tab drains too (v${hidden.version}, ${hidden.posts} POST)`);
  }
} finally {
  await browser.close();
}
check.done();
