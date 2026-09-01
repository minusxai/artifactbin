/**
 * Gate: the document chrome has to fit on a phone.
 *
 * Three faults this pins, all found by looking at a 390px window:
 *
 *  1. The story editor's bar is one non-wrapping flex row, so on a narrow
 *     screen it ran past the viewport and `done` — the only way out of edit
 *     mode, and the thing that saves your work on the way (gate-editor-exit)
 *     — sat off-screen where no thumb can reach it.
 *  2. The theme popover is a fixed `w-[26rem]` two-column grid, wider than the
 *     screen it opens on: half the themes clipped, and the page grew a
 *     horizontal scrollbar.
 *  3. The reader actions belong in one thumb-reachable bottom dock. It gets
 *     out of the document's way on downward scroll and returns on reverse.
 *
 * Both are checked as GEOMETRY, not as classes — an element's own rect against
 * the viewport is the only thing that survives a refactor of the styling.
 *
 *   usage: node scripts/gate-mobile.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const PHONE = { width: 390, height: 844 };
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

const DOC = '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Mobile</h1>'
  + Array.from({ length: 28 }, (_, i) => `<p className="mt-4 text-lg">A document being read on a phone. ${i + 1}</p>`).join('')
  + '</div>';

// The token rides the start LINK now, not the response body (lib/agent-session).
const st = await startDocument(B);
await fetch(`${B}/api/artifacts/${st.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
  body: JSON.stringify({ title: 'mobile gate', markup: DOC, theme: 'manuscript' }),
});

const browser = await chromium.launch();

const open = async (viewport, hash = '') => {
  const page = await browser.newPage({ viewport });
  // The shell belongs to the OWNER (a reader is served the bare document), and
  // ownership is the httpOnly session cookie now — not a localStorage token.
  await becomeOwner(page, B, st.token);
  await page.goto(`${B}/a/${st.id}${hash}`, { waitUntil: 'load' });
  return page;
};

/**
 * Does the contextual EDITOR bar overflow its own box? Reading has no bar.
 */
const barOverflows = (page) => page.evaluate(() => {
  const bar = document.querySelector('header');
  return bar ? bar.scrollWidth > bar.clientWidth + 1 : true;
});

/** Does the PAGE scroll sideways? The plainest symptom of chrome that overflows. */
const overflows = (page) => page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/** Is this element's box inside the viewport, horizontally? */
const fitsAcross = (page, label) => page.evaluate((l) => {
  const el = document.querySelector(`[aria-label="${l}"]`);
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const w = document.documentElement.clientWidth;
  return { found: true, left: Math.round(r.left), right: Math.round(r.right), viewport: w, fits: r.left >= -1 && r.right <= w + 1 };
}, label);

// ── 1. the viewer on a phone ───────────────────────────────────────────────
const view = await open(PHONE);
await view.waitForTimeout(2500);
ok(!(await overflows(view)), 'viewer: the page does not scroll sideways');
for (const label of ['Open menu', 'Home', 'Open artifact controls']) {
  const control = await fitsAcross(view, label);
  ok(control.fits, `viewer: ${label.toLowerCase()} fits (${control.left}..${control.right}px of ${control.viewport}px)`);
}
const dock = await view.evaluate(() => {
  const menu = document.querySelector('[aria-label="Open menu"]')?.getBoundingClientRect();
  const home = document.querySelector('[aria-label="Home"]')?.getBoundingClientRect();
  const controls = document.querySelector('[aria-label="Open artifact controls"]')?.getBoundingClientRect();
  const barElement = document.querySelector('[data-mx-reader-chrome], [aria-label="Page actions"]');
  const bar = barElement?.getBoundingClientRect();
  return {
    menuTop: menu?.top ?? -1,
    homeTop: home?.top ?? -1,
    controlsTop: controls?.top ?? -1,
    menuCenter: menu ? menu.left + menu.width / 2 : -1,
    homeCenter: home ? home.left + home.width / 2 : -1,
    controlsCenter: controls ? controls.left + controls.width / 2 : -1,
    barLeft: bar?.left ?? -1,
    barRight: bar?.right ?? -1,
    labels: [...(barElement?.querySelectorAll('[data-mobile-label]') ?? [])].map((label) => label.textContent?.trim()),
    width: window.innerWidth,
    height: window.innerHeight,
  };
});
ok(dock.menuTop > dock.height - 100 && dock.homeTop > dock.height - 100 && dock.controlsTop > dock.height - 100,
  `viewer: all three actions sit in the bottom dock (tops ${Math.round(dock.menuTop)}, ${Math.round(dock.homeTop)}, ${Math.round(dock.controlsTop)} of ${dock.height}px)`);
ok(Math.abs(dock.barLeft) <= 1 && Math.abs(dock.barRight - dock.width) <= 1,
  `viewer: the bottom dock spans the viewport (${Math.round(dock.barLeft)}..${Math.round(dock.barRight)} of ${dock.width}px)`);
ok(Math.abs(dock.homeCenter - dock.width / 2) <= 1,
  `viewer: home is centered (${Math.round(dock.homeCenter)} of ${dock.width / 2}px)`);
ok(
  Math.abs(dock.menuCenter - dock.width / 6) <= 1
    && Math.abs(dock.controlsCenter - dock.width * 5 / 6) <= 1,
  `viewer: side actions are centered in equal thirds (${Math.round(dock.menuCenter)}, ${Math.round(dock.homeCenter)}, ${Math.round(dock.controlsCenter)}px)`,
);
ok(dock.labels.join(',') === 'menu,home,controls', `viewer: tiny labels read menu / home / controls (${dock.labels.join(', ')})`);

const dockHidden = () => view.evaluate(() => {
  const action = document.querySelector('[aria-label="Open menu"]');
  const host = action?.closest('[data-mx-reader-chrome], [aria-label="Page actions"]');
  return host?.getAttribute('data-scroll-hidden') === 'true'
    || host?.classList.contains('mx-reader-chrome--hidden') === true;
});
// An owner reads through the sandboxed artifact frame; a public reader may be
// served the document itself. Exercise whichever window actually scrolls.
const readingFrame = view.frames().find((frame) => frame !== view.mainFrame()) ?? view.mainFrame();
await readingFrame.evaluate(() => window.scrollTo(0, 500));
await view.waitForTimeout(300);
ok(await dockHidden(), 'viewer: the bottom dock leaves on downward scroll');
await readingFrame.evaluate(() => window.scrollBy(0, -80));
await view.waitForTimeout(300);
ok(!(await dockHidden()), 'viewer: the bottom dock returns on reverse scroll');

// ── 2. the app menu on a phone ─────────────────────────────────────────────
// Navigation folds out from the page's hamburger.
await view.locator('[aria-label="Open menu"]').click({ timeout: 30_000 });
await view.waitForSelector('[aria-label="Menu"]', { timeout: 10_000 });
await view.waitForTimeout(300);
const menu = await fitsAcross(view, 'Menu');
ok(menu.fits, `app menu: fits the screen (${menu.left}..${menu.right}px of ${menu.viewport}px)`);
ok(!(await overflows(view)), 'app menu: and opening it does not make the page scroll sideways');
const clippedItems = await view.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll('[aria-label="Menu"] a, [aria-label="Menu"] button')]
    .filter((el) => el.getBoundingClientRect().right > w + 1).length;
});
ok(clippedItems === 0, `app menu: no item is cut off (${clippedItems} clipped)`);
await view.keyboard.press('Escape');
await view.click('[aria-label="Open artifact controls"]');
await view.waitForSelector('[aria-label="Artifact controls"]');
const controls = await fitsAcross(view, 'Artifact controls');
ok(controls.fits, `artifact controls: sheet fits the screen (${controls.left}..${controls.right}px of ${controls.viewport}px)`);
ok(!(await overflows(view)), 'artifact controls: and opening it does not make the page scroll sideways');
await view.close();

// ── 3. the editor on a phone: `done` and the theme picker must be reachable ─
const edit = await open(PHONE, '#edit');
await edit.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
await edit.waitForTimeout(2000);
// The theme picker lives in the EDITOR bar now.
await edit.locator('[aria-label="Theme"]').click({ timeout: 30_000 });
await edit.waitForSelector('[aria-label="Themes"]', { timeout: 10_000 });
await edit.waitForTimeout(300);
const pop = await fitsAcross(edit, 'Themes');
ok(pop.fits, `theme popover: fits the screen (${pop.left}..${pop.right}px of ${pop.viewport}px)`);
ok(!(await overflows(edit)), 'theme popover: and opening it does not make the page scroll sideways');
// Every theme has to be reachable, not merely present in the DOM.
const clipped = await edit.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll('[aria-label^="Theme "]')]
    .filter((el) => el.getBoundingClientRect().right > w + 1).length;
});
ok(clipped === 0, `theme popover: no theme card is cut off (${clipped} clipped)`);
await edit.keyboard.press('Escape');
await edit.waitForTimeout(300);
const done = await fitsAcross(edit, 'Exit edit mode');
ok(done.fits, `editor: \`done\` is on screen (${done.left}..${done.right}px of ${done.viewport}px)`);
ok(!(await overflows(edit)), 'editor: the page does not scroll sideways');
ok(!(await barOverflows(edit)), 'editor: and the whole action row fits the bar');
// The real test of reachable: Playwright refuses to click what a user could not.
const clicked = await edit.locator('[aria-label="Exit edit mode"]').click({ timeout: 5000 }).then(() => true).catch(() => false);
ok(clicked, 'editor: and it can actually be pressed');
await edit.close();

// ── 4. the desktop layout is not collateral damage ─────────────────────────
const wide = await open({ width: 1600, height: 1000 }, '#edit');
await wide.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
await wide.waitForTimeout(2000);
await wide.locator('[aria-label="Theme"]').click({ timeout: 30_000 });
await wide.waitForSelector('[aria-label="Themes"]', { timeout: 10_000 });
const cols = await wide.evaluate(() => {
  const el = document.querySelector('[aria-label="Themes"]');
  return getComputedStyle(el).gridTemplateColumns.split(' ').length;
});
ok(cols >= 2, `desktop: the popover keeps its multi-column grid (${cols} columns)`);

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
const reachable = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { found: true, reachable: !!(hit && el.contains(hit)), hit: hit?.tagName ?? null };
}, sel);

const card = await reachable(wide, '[aria-label^="Theme "]');
ok(card.reachable, `desktop: a theme card can actually be clicked (hit ${card.hit})`);
await wide.keyboard.press('Escape');
await wide.waitForTimeout(300);

// The mode dropdown shares the scroller and so shared the bug.
await wide.locator('[aria-label="Color mode"]').click({ timeout: 30_000 });
await wide.waitForSelector('[aria-label="Color modes"]', { timeout: 10_000 });
await wide.waitForTimeout(200);
const option = await reachable(wide, '[aria-label="Color mode dark"]');
ok(option.reachable, `desktop: a colour-mode option can actually be clicked (hit ${option.hit})`);
await wide.close();

await browser.close();
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
