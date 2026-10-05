import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/**
 * EVERY WAY OUT OF THE EDITOR — split out of gate-editor-v2.mjs (its section 5) so no gate shard
 * waits on one two-minute script — and the way out on a PHONE (was gate-mobile's editor sections):
 * the editor bar is one non-wrapping flex row, so on a narrow screen it ran past the viewport and
 * `done`, the only way out and the thing that saves your work on the way, sat off-screen; the theme
 * popover was a fixed two-column grid wider than the screen it opens on. Checked as GEOMETRY, not
 * classes: an element's own rect against the viewport survives a refactor of the styling.
 *
 *   usage: node scripts/gates/gate-editor-exits.mjs [base]
 */
import { launchChromium } from './lib/browser.mjs';
import { documentFrame } from './lib/page-facts.mjs';
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
      // The document is framed by the app page on its own origin; the heading is typed into there.
      const frame = await documentFrame(page);
      await frame.waitForFunction(() => !!document.querySelector('h1')?.isContentEditable, null, { timeout: 60_000 });
      await frame.evaluate(() => {
        const h = document.querySelector('h1');
        // The editing host takes focus (and with it the frame, so the keyboard reaches it), not the heading in it.
        (h.closest('[contenteditable="true"]') ?? h).focus();
        const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await page.keyboard.type(stamp);
      const inDocument = await frame.evaluate(() => document.querySelector('h1')?.textContent ?? '');
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
        // A hidden tab hides every document in it: the app page and the document framed in it.
        const hide = () => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        await page.evaluate(hide);
        await frame.evaluate(hide);
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

  /* ── 6. THE WAY OUT ON A PHONE: `done` and the theme picker must be reachable ── */
  {
    const PHONE = { width: 390, height: 844 };
    const DOC = '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Mobile</h1>'
      + Array.from({ length: 28 }, (_, i) => `<p className="mt-4 text-lg">A document being read on a phone. ${i + 1}</p>`).join('')
      + '</div>';
    const st = await startDocument(base);
    await fetch(`${base}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({ title: 'mobile gate', markup: DOC, theme: 'manuscript' }),
    });
    const open = async (viewport, hash = '') => {
      const page = await browser.newPage({ viewport });
      // The editor belongs to the OWNER, and ownership is the httpOnly session cookie.
      await becomeOwner(page, base, st.token);
      await page.goto(`${base}/a/${st.id}${hash}`, { waitUntil: 'load' });
      return page;
    };
    /** Does the contextual EDITOR bar overflow its own box? */
    const barOverflows = (page) => page.locator('header').first().evaluate(bar => {
      return bar ? bar.scrollWidth > bar.clientWidth + 1 : true;
    });
    /** Does the PAGE scroll sideways? The plainest symptom of chrome that overflows. */
    const overflows = (page) => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    /** Is this element's box inside the viewport, horizontally? */
    const fitsAcross = (page, label) => page.getByLabel(label, { exact: true }).first().evaluate((el) => {
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const w = document.documentElement.clientWidth;
      return { found: true, left: Math.round(r.left), right: Math.round(r.right), viewport: w, fits: r.left >= -1 && r.right <= w + 1 };
    }).catch(() => ({ found: false, fits: false }));

    const edit = await open(PHONE, '#edit');
    await edit.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
    await edit.waitForTimeout(2000);
    // Appearance controls live in the mobile Selection sheet.
    await edit.getByRole('button', { name: 'Show selection settings', exact: true }).click();
    await edit.locator('[aria-label="Design system"]').click({ timeout: 30_000 });
    await edit.waitForSelector('[aria-label="Design systems"]', { timeout: 10_000 });
    await edit.waitForTimeout(300);
    const pop = await fitsAcross(edit, 'Design systems');
    check(pop.fits, `theme popover: fits the screen (${pop.left}..${pop.right}px of ${pop.viewport}px)`);
    check(!(await overflows(edit)), 'theme popover: and opening it does not make the page scroll sideways');
    // Every theme has to be reachable, not merely present in the DOM.
    const clipped = await edit.locator('[aria-label^="Design system "]').evaluateAll(elements => {
      const w = document.documentElement.clientWidth;
      return elements
        .filter((el) => el.getBoundingClientRect().right > w + 1).length;
    });
    check(clipped === 0, `theme popover: no theme card is cut off (${clipped} clipped)`);
    await edit.keyboard.press('Escape');
    await edit.waitForTimeout(300);
    await edit.keyboard.press('Escape');
    const done = await fitsAcross(edit, 'Exit edit mode');
    check(done.fits, `editor: \`done\` is on screen (${done.left}..${done.right}px of ${done.viewport}px)`);
    check(!(await overflows(edit)), 'editor: the page does not scroll sideways');
    check(!(await barOverflows(edit)), 'editor: and the whole action row fits the bar');
    // The real test of reachable: Playwright refuses to click what a user could not.
    const clicked = await edit.locator('[aria-label="Exit edit mode"]').click({ timeout: 5000 }).then(() => true).catch(() => false);
    check(clicked, 'editor: and it can actually be pressed');
    await edit.close();

    /* ── 7. the desktop layout is not collateral damage (was gate-mobile section 4) ── */
    const wide = await open({ width: 1600, height: 1000 }, '#edit');
    await wide.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
    await wide.waitForTimeout(2000);
    await wide.locator('[aria-label="Design system"]').click({ timeout: 30_000 });
    await wide.waitForSelector('[aria-label="Design systems"]', { timeout: 10_000 });
    const cols = await wide.locator('[aria-label="Design systems"]').evaluate(el => {
      return getComputedStyle(el).gridTemplateColumns.split(' ').length;
    });
    check(cols >= 2, `desktop: the popover keeps its multi-column grid (${cols} columns)`);
    /*
     * AND IT MUST BE REACHABLE, NOT MERELY PRESENT. The toolbar's left group is a
     * scroller so the controls can slide on a phone; `overflow-x: auto` makes the
     * OTHER axis `auto` too, turning that group into a ~26px clip box, and an
     * `absolute top-full` panel opened straight into it. Everything above still
     * passed — the panel had a real bounding box, two grid columns and no
     * horizontal overflow — while painting nothing and letting every click fall
     * through to the document iframe. So the check is a hit test: whatever is at
     * the middle of the first card has to BE the card.
     */
    const reachable = (page, sel) => page.locator(sel).first().evaluate(el => {
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      let hit = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
      return { found: true, reachable: !!(hit && el.contains(hit)), hit: hit?.tagName ?? null };
    });
    const card = await reachable(wide, '[aria-label^="Design system "]');
    check(card.reachable, `desktop: a theme card can actually be clicked (hit ${card.hit})`);
    await wide.keyboard.press('Escape');
    await wide.waitForTimeout(300);
    // The mode dropdown shares the scroller and so shared the bug.
    await wide.locator('[aria-label="Color mode"]').click({ timeout: 30_000 });
    await wide.waitForSelector('[aria-label="Color modes"]', { timeout: 10_000 });
    await wide.waitForTimeout(200);
    const option = await reachable(wide, '[aria-label="Color mode dark"]');
    check(option.reachable, `desktop: a colour-mode option can actually be clicked (hit ${option.hit})`);
    await wide.close();
  }
} finally {
  await browser.close();
}
check.done();
