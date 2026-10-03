/**
 * Gate: READING GEOMETRY — where a document sits, moves and scrolls, measured in Chromium at desktop and phone
 * widths, as one walk through the reading surface.
 *
 *   1. DECKS (was gate-layout-shift): the document's left edge never moves after first paint, reading or editing,
 *      deck or not; the rail is an xl-and-up column; a full-bleed slide built from our guidance, or one the author
 *      got wrong, never scrolls the page sideways; the rail, the present bar and the counter navigate; the capture
 *      render carries no chrome; raw h-screen slides measure the frame's viewport (lib/viewport-geometry).
 *   2. THE OUTLINE AND WIDE TABLES (was gate-reading-chrome): a table of contents on first paint at its final width,
 *      marking and navigating sections, gone on a phone, never beside a deck; a wide table scrolls inside its column
 *      and says so; a live agent write brings new sections and tables into both; the rail is legible in dark mode.
 *   3. THE PHONE (was gate-mobile, its reader legs): the app bar's menu and controls sheet fit and paint above the
 *      reader actions; a chart tooltip opened by touch carries a 44px close target and leaves on a scroll, while a
 *      mouse-opened one does not; a touch selection raises the comment bubble below the words.
 *   4. CHART WIDTH (was gate-chart-width): a served chart and Vega's first draw agree on slot width and axis ticks.
 *   5. NO SIDEWAYS SCROLL (was gate-app-flows' MOBILE pages): the viewer, a deck, /docs and /login at phone width.
 *
 * What left, and where it lives now:
 *   - the capture render has no outline (reading-chrome 134) → services/app/__tests__/reading-chrome.test.ts;
 *   - the og export PNG (reading-chrome 236–239) → the exports journey gate, which holds one PNG set for the suite;
 *   - gate-app-flows' deck rail and paging (its 235–243) repeated leg 1's navigation verbatim, so it runs once here;
 *   - gate-mobile's editor legs (theme popover, `done` on a phone, desktop popover reachability: its 153–225) are
 *     the editor's, gate-editor-exits'.
 *
 *   usage: node scripts/gates/gate-reading-geometry.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { checkViewportGeometry } from './lib/viewport-geometry.mjs';
import { DOCUMENT_FRAME, documentFrame, documentLocator, horizontalOverflow } from './lib/page-facts.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('reading-geometry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** One leg's failure is reported and the walk goes on, so a run names every broken leg at once. */
const section = async (name, run) => {
  console.log(`█ ${name}`);
  try { await run(); } catch (error) { check(false, `${name}: the leg threw (${String(error?.message ?? error).split('\n')[0].slice(0, 300)})`); }
};

const browser = await launchChromium();
/** The deck leg 1 measures; leg 5 reads it at phone width too. */
let deckId = null;
/** The plain document the phone legs read; leg 5 reads it as the viewer. */
let phoneDocId = null;

// ── 1. decks: no shift, no sideways scroll, navigation inside the document (was gate-layout-shift) ──
await section('decks', async () => {
  const B = BASE;
  const slide = (n) => `<Slide title="Slide ${n}"><h1 className="text-5xl font-bold">Heading ${n}</h1>`
    + `<p className="mt-4 text-lg">Body copy for slide ${n}.</p></Slide>`;
  /*
   * Leg 7's deck is its own: navigating between slides needs slides a reader can
   * actually scroll BETWEEN (full-height, centred — the shape a deck is written
   * in), and the Icon is load-bearing because the rail is a render path of its
   * own that once shipped with the text present and a hole where the icon goes.
   */
  const NAV_DECK = `<Helmet><title>Deck gate</title></Helmet>
  <SlideDeck>
    <Slide title="Cover" className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-5xl font-bold">The Cover Slide</h1>
      <Icon name="chart-column" />
      <p className="text-muted-foreground">First slide body copy.</p>
    </Slide>
    <Slide title="Middle" className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-5xl font-bold">The Middle Slide</h1>
    </Slide>
    <Slide title="Close" className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-5xl font-bold">The Closing Slide</h1>
    </Slide>
  </SlideDeck>`;
  const DECK = `<SlideDeck>${slide(1)}${slide(2)}${slide(3)}${slide(4)}</SlideDeck>`;
  const PLAIN = '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Ordinary</h1>'
    + '<p className="mt-4 text-lg">No slides here.</p></div>';
  /*
   * The FULL-BLEED idiom, copied from what we teach (orchestrator/prompts/
   * skills/templates, lib/data/story/typography.ts
   * FULL_BLEED_CLASSES): the page wrapper carries the gutter and a full-bleed
   * slide cancels it with a negative margin, re-adding it as padding.
   *
   * The two halves are container queries, and they only cancel if they resolve
   * against the SAME container. They did not: `@2xl:-mx-12` on the slide has an
   * ancestor container (the wrapper), while the wrapper's OWN `@2xl:px-12` looks
   * for an ancestor container of its own and used to find none — so the slide
   * cancelled 48px of gutter that was only ever 24px, on every deck, at every
   * desktop width.
   */
  const BLEED_DECK = '<div data-design="tw" className="@container px-6 @2xl:px-12"><SlideDeck>'
    + '<Slide title="Cover" className="border-b border-border py-14"><h1 className="text-6xl font-bold">Cover</h1></Slide>'
    + '<Slide title="Act one" className="justify-center bg-primary text-primary-foreground -mx-6 @2xl:-mx-12 px-6 @2xl:px-12">'
    + '<span className="text-9xl font-bold text-primary-foreground/25">01</span>'
    + '<h2 className="mt-2 text-4xl font-semibold">Act title</h2></Slide>'
    + '<Slide title="Act two" className="border-b border-border py-14"><h2 className="text-3xl font-semibold">After</h2></Slide>'
    + '</SlideDeck></div>';

  async function mint(markup) {
    // The token comes from the start LINK now — /api/start hands the browser a
    // cookie, not a secret (lib/agent-session).
    const st = await startDocument(B);
    await fetch(`${B}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({ title: 'layout gate', markup, theme: 'modernist' }),
    });
    return st;
  }

  /** Sample the canvas's left edge from first paint until the rail has settled. */
  async function watchCanvas(id, { edit = false, token, width = 1600 } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    // The shell — and therefore the canvas this measures — belongs to the OWNER;
    // anyone else is served the document itself, with no parent-side rail to
    // shift. Ownership is the httpOnly session cookie now, not a localStorage
    // token, so it is exchanged rather than seeded. Without it, view mode would
    // measure a bare document and edit mode the unlock card — either way passing
    // every check below by measuring nothing.
    await becomeOwner(page, B, token);
    // The rail is `xl:block` — below that width it never shows and there is
    // nothing to measure. 1600 is comfortably past it.
    // Shifts are ATTRIBUTED, not just totalled: this page also moves its footer
    // as the canvas gets its height (pre-existing, ~0.065, unrelated to the rail),
    // and a gate that asserted a global CLS number would either fail on that
    // forever or be loosened until it could no longer see the 0.11 the rail used
    // to cost.
    await page.addInitScript(() => {
      window.__shifts = [];
      // Attribute the source while its DOM ancestry still exists. Toolbar divs
      // (such as the GitHub star control) are not the document or slide rail.
      const region = '.mx-doc, .mx-rail, [aria-label="Slide overview"], [aria-label="Slides"]';
      const movesDocument = (node) => !!node && (
        !!node.closest?.(region) || !!node.querySelector?.(region)
      );
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__shifts.push({ value: e.value, movesDocument: (e.sources || []).some((s) => movesDocument(s.node)) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${B}/a/${id}${edit ? '#edit' : ''}`, { waitUntil: 'commit', timeout: 60000 });
    // Edit mode adds a bar around the document; wait for it before taping, so
    // what is measured is the document settling rather than the bar arriving.
    // The top bar's edit control becomes the exit while editing.
    if (edit) await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });


    /*
     * Both modes measure the DOCUMENT, because there is only one.
     *
     * Edit mode used to measure the page: the 0.11 CLS this gate exists for came
     * from a second canvas and a parent-side rail appearing there. Neither
     * exists now — entering edit is a message to the document already on screen
     * — so what is worth asserting is that the document itself does not move.
     */
    // The document is framed on its own origin; the init script above ran in the frame too, so it is measured there.
    const target = await documentFrame(page, { timeout: 60_000 });
    // `attached`, not `visible`: the rail's previews are scaled to a few pixels,
    // so the first matching element is legitimately not "visible" to Playwright.
    await target.waitForSelector('[data-mx-inline-story]', { state: 'attached', timeout: 60_000 });

    const samples = await target.evaluate(async () => {
      const seen = [];
      for (let i = 0; i < 160; i++) { // ~8s, well past any late arrival
        // Ordered by preference, not by a selector list: a list returns whatever
        // comes first in the DOM, and the story root (the body) always would.
        const el = document.querySelector('.mx-doc')

          ?? document.querySelector('[data-mx-inline-story]');
        if (el) {
          const x = Math.round(el.getBoundingClientRect().left);
          if (seen[seen.length - 1] !== x) seen.push(x);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const shifts = window.__shifts ?? [];
      const blamed = shifts.filter((x) => x.movesDocument);
      return {
        seen,
        shifts: shifts.reduce((a, b) => a + b.value, 0),
        railShift: blamed.reduce((a, b) => a + b.value, 0),
        // Rail rows are plain divs inside the overview; catch them by position
        // instead — any shift at all after the document has painted.
        lateShift: shifts.filter((x) => x.value > 0.005).length,
      };
    });
    const railEntries = await target.locator('[aria-label^="Go to slide"]').count();
    // Below the breakpoint the rail exists in the DOM but is display:none, so ask
    // the browser whether it actually occupies anything.
    const railHidden = await target.evaluate(() => {
      const el = document.querySelector('[aria-label="Slide overview"], .mx-rail');
      return !el || el.getBoundingClientRect().width === 0;
    });
    await page.close();
    return { ...samples, railEntries, railHidden };
  }

  /* Observe the same four cases in pairs. Four cold rendering pages can saturate
   * a small CI runner before navigation commits; each case still samples every
   * frame over its original observation window. */
  const deck = await mint(DECK);
  const plain = await mint(PLAIN);
  const [d, e] = await Promise.all([
    // 1. a deck: the rail is there from the start and nothing moves
    watchCanvas(deck.id, { token: deck.token }),
    // 2. entering edit mode is the same page, and must behave the same
    watchCanvas(deck.id, { edit: true, token: deck.token }),
  ]);
  const [p, m] = await Promise.all([
    // 3. an ordinary document must not pay for the deck's column
    watchCanvas(plain.id, { token: plain.token }),
    // 4. mobile: the rail is an xl-and-up affordance, and must stay one
    watchCanvas(deck.id, { token: deck.token, width: 390 }),
  ]);

  check(d.railEntries >= 2, `deck: the rail did arrive (${d.railEntries} entries) — otherwise this proves nothing`);
  check(d.seen.length === 1, `deck: the document's left edge never moves (positions seen: ${d.seen.join(' -> ')})`);
  check(d.railShift === 0, `deck: nothing shifts the canvas or the rail (attributed CLS ${d.railShift.toFixed(4)})`);
  console.log(`       (page CLS ${d.shifts.toFixed(4)} — the remainder is the footer settling as the canvas gets its height, which predates this gate)`);

  // Without proving the rail actually turned up, "it never moved" is what a page
  // with no rail at all also reports.
  check(e.railEntries >= 2, `edit mode: the rail is there too (${e.railEntries} entries)`);
  check(e.seen.length === 1, `edit mode: the document's left edge never moves (positions seen: ${e.seen.join(' -> ')})`);

  check(p.railEntries === 0, 'plain: no rail, as before');
  check(p.seen.length === 1, `plain: and it still does not move (positions seen: ${p.seen.join(' -> ')})`);
  // The reserved column is for DECKS only: an ordinary document that indents
  // itself by 190px for a rail it will never show is a different bug with the
  // same shape.
  check(p.seen[0] < d.seen[0], `plain: and sits further left than a deck (${p.seen[0]}px vs ${d.seen[0]}px)`);

  // A reserved column that leaked below the breakpoint would indent every phone
  // reader by 190px for a rail their screen never shows.
  check(m.railEntries === 0 || m.railHidden, 'mobile: no rail column on a phone-width viewport');
  check(m.seen.length === 1, `mobile: and the document never moves (positions seen: ${m.seen.join(' -> ')})`);
  check(m.seen[0] < 40, `mobile: the document uses the full width (left edge ${m.seen[0]}px)`);

  // ── 5. a deck built from our own guidance must not scroll sideways ────────
  /*
   * Measured INSIDE the frame, where the document's own scrollport is: the page
   * around it has its own width and would answer a different question.
   */
  async function measureBleed(id, token, width = 1600) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await becomeOwner(page, B, token);
    await page.goto(`${B}/a/${id}`, { waitUntil: 'commit', timeout: 60000 });
    const target = await documentFrame(page, { timeout: 60_000 });
    await target.waitForSelector('.mx-doc', { state: 'attached', timeout: 60_000 });
    // Past every late arrival — a font landing can widen a line after first paint.
    await page.waitForTimeout(2500);
    const measured = await target.evaluate(() => {
      const de = document.documentElement;
      const column = document.querySelector('.mx-doc').getBoundingClientRect();
      const rail = document.querySelector('.mx-rail');
      // The bleed slide is the one with a negative inline margin — found by what
      // it DOES, so the fixture's class names are not a second thing to keep true.
      const bleed = [...document.querySelectorAll('.mx-doc *')]
        .find((el) => parseFloat(getComputedStyle(el).marginLeft) < 0);
      return {
        overflow: de.scrollWidth - de.clientWidth,
        railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
        columnLeft: Math.round(column.left),
        columnRight: Math.round(column.right),
        bleedLeft: bleed ? Math.round(bleed.getBoundingClientRect().left) : null,
        bleedRight: bleed ? Math.round(bleed.getBoundingClientRect().right) : null,
      };
    });
    await page.close();
    return measured;
  }

  const bleedDeck = await mint(BLEED_DECK);

  // ── 6. a bleed the author got WRONG must still not scroll the page ─────────
  /*
   * Leg 5 proves the taught idiom cancels; this one proves the column survives
   * an idiom that CANNOT cancel. A real dashboard shipped the standard bleed
   * classes (`-mx-6 @2xl:-mx-12 px-6 @2xl:px-12`) on a header span inside a
   * wrapper whose gutter was `px-4 @2xl:px-6` — a 48px pull against a 24px
   * gutter, so 24px of the document hung past the column and the whole page
   * scrolled sideways by a sliver. No container resolution fixes a mismatch the
   * author wrote; the column itself must refuse to let anything past its edge.
   */
  const MISMATCH = '<div data-design="tw" className="@container min-h-screen bg-background px-4 py-4 @2xl:px-6">'
    + '<header className="border-b-2 border-foreground pb-3"><div className="flex items-baseline justify-between gap-4">'
    + '<h1 className="text-3xl font-bold">Payroll</h1>'
    + '<span className="font-mono text-[11px] uppercase -mx-6 @2xl:-mx-12 px-6 @2xl:px-12">snapshot · aug 2026</span>'
    + '</div></header><p className="mt-4 text-lg">Tiles below.</p></div>';
  const mismatch = await mint(MISMATCH);
  const [b, mm] = await Promise.all([
    measureBleed(bleedDeck.id, bleedDeck.token),
    measureBleed(mismatch.id, mismatch.token),
  ]);
  check(b.railWidth > 0 && b.bleedLeft !== null,
    `bleed: the rail and the full-bleed slide are both there (rail ${b.railWidth}px) — otherwise this proves nothing`);
  check(b.overflow === 0, `bleed: the deck does not scroll sideways (${b.overflow}px of horizontal overflow)`);
  // The point of the idiom is edge-to-edge WITHIN the column. Landing left of it
  // is the same 24px seen from the other end: blue paint on top of the rail.
  check(b.bleedLeft >= b.columnLeft, `bleed: the slide stays out of the rail (slide left ${b.bleedLeft}px vs column ${b.columnLeft}px)`);
  check(b.bleedRight <= b.columnRight, `bleed: and inside the column's right edge (slide right ${b.bleedRight}px vs column ${b.columnRight}px)`);
  check(mm.bleedLeft !== null, 'mismatch: the overshooting element is there — otherwise this proves nothing');
  check(mm.overflow === 0, `mismatch: the document still does not scroll sideways (${mm.overflow}px of horizontal overflow)`);

  // ── 7. the deck's navigation chrome, which lives INSIDE the document ───────
  /*
   * The parent cannot reach into the served document, so the rail and the
   * present bar are the document's own — and the same deck that proved it never
   * shifts (leg 1) is the honest place to prove it NAVIGATES. Previews are
   * checked for their glyphs as well as their text: the rail is a render path of
   * its own and shipped once with the text present and a hole where the icon
   * goes, which innerText cannot see.
   */
  {
    /*
     * Published WITHOUT this gate's theme override: the deck-chrome legs measure
     * scroll positions, and a theme that changes slide heights changes where a
     * slide can come to rest. The CLS legs above want the theme; these want the
     * shipped default.
     */
    const navDeck = await startDocument(B);
    await fetch(`${B}/api/artifacts/${navDeck.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${navDeck.token}` },
      body: JSON.stringify({ markup: NAV_DECK }),
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await becomeOwner(page, B, navDeck.token);
    await page.goto(`${B}/a/${navDeck.id}`, { waitUntil: 'load' });
    const frame = await documentFrame(page);
    // SCOPED to the document column: the rail's previews are real <Slide>
    // elements too (that is what makes them faithful), so an unscoped query
    // measures a miniature.
    const SLIDES = '.mx-doc [data-mx-slide]';
    await frame.waitForSelector(SLIDES, { timeout: 20_000 });
    const slideTop = (index) => frame.evaluate(
      ([selector, i]) => Math.abs(document.querySelectorAll(selector)[i].getBoundingClientRect().top),
      [SLIDES, index],
    );

    check(await frame.evaluate(() => !!document.querySelector('.mx-rail')), 'the rail is in the served document');
    check(await frame.evaluate(() => document.querySelector('.mx-rail-thumb')?.innerText.includes('The Cover Slide')),
      'rail previews render the slide content');
    check(await frame.evaluate(() => !!document.querySelector('.mx-rail-thumb svg')),
      "rail previews draw the slide's icons too (server-resolved glyphs reach the rail)");
    check(await frame.evaluate(() => document.querySelectorAll('.mx-rail-row').length === 3), 'one rail row per slide');

    // The rail is SERVER-RENDERED, so every check above holds before hydration —
    // and clicking a row is the first thing here that needs the handler to exist.
    // Without this wait the click lands on static markup and scrolls nothing.
    await page.waitForTimeout(2500);
    await frame.click('[aria-label="Go to slide 3: Close"]');
    await page.waitForTimeout(1500);
    check(await slideTop(2) < 60, 'clicking a rail row scrolls to that slide');
    await page.waitForTimeout(500);
    check(await frame.evaluate(() => document.querySelectorAll('.mx-rail-row')[2].getAttribute('aria-current') === 'true'),
      'the active row follows the reader');

    await frame.click('[aria-label="Go to slide 1: Cover"]');
    await page.waitForTimeout(1200);
    await frame.evaluate(() => document.querySelector('.mx-present').scrollIntoView());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    check(await slideTop(1) < 60, 'ArrowRight pages to the next slide');
    check(await frame.evaluate(() => document.querySelector('[aria-label="Slide position"]').innerText.trim()) === '2 / 3',
      'the counter tracks position');

    // The CAPTURE render — what /export screenshots — carries no chrome at all.
    const capture = await fetch(`${B}/a/${navDeck.id}/raw?chrome=0`, {
      headers: { Authorization: `Bearer ${navDeck.token}` },
    });
    check(capture.status === 200, 'the owner can read the capture render');
    const bare = await capture.text();
    check(!bare.includes('Slide controls') && !bare.includes('mx-rail'), 'the capture render (?chrome=0) has no chrome');
    check(bare.includes('The Cover Slide'), 'and still carries the document');
    await page.close();
  }

  deckId = deck.id;
  await checkViewportGeometry(B, browser, check);
});

// ── 2. the outline and wide tables (was gate-reading-chrome) ──
await section('outline and tables', async () => {
  /*
   * The document runs in its own frame on its own origin (lib/serving/document-frame) and scrolls there; the app page
   * around it is only the bar. So every question about the reading surface is asked INSIDE the frame.
   */
  const inDoc = async (page, fn, arg) => (await documentFrame(page)).evaluate(fn, arg);

  /*
   * Every document this gate starts, so a run can take them away again. It
   * matters most where it costs most: run against production and the six
   * fixtures below are six public documents that outlive the run. A FAILING
   * run keeps them — that is the evidence someone will want to open.
   */
  const created = [];
  const start = async () => { const st = await startDocument(BASE); created.push(st); return st; };
  async function cleanup() {
    const gone = await Promise.all(created.map((st) => fetch(`${BASE}/api/artifacts/${st.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${st.token}` },
    }).then((r) => r.ok).catch(() => false)));
    console.log(`\ncleaned up ${gone.filter(Boolean).length}/${created.length} fixture document(s)`);
  }


  /** Poll `read()` until `want`, or give up. Returns the last value seen. */
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

  const WIDE_ROW = '<tr><td>Storage</td><td><code>lib/story/datasets/dataset-store.ts</code></td><td>One content-addressed JSON blob; the row keeps meta.objectKey, columns, rowCount. Capped at ten thousand rows, which is plenty for a poll.</td></tr>';
  const section = (i, title) =>
    `<section className="mt-24"><h2 className="text-2xl font-semibold tracking-tight">${i}. ${title}</h2>`
    + Array.from({ length: 6 }, (_, k) => `<p className="mt-4 leading-relaxed">Paragraph ${k + 1} of section ${i}. Long enough to give the reader something to scroll through before the next heading arrives.</p>`).join('')
    + '</section>';
  const DOC = '<article data-design="tw" className="mx-auto max-w-2xl px-6 py-12">'
    + '<h1 className="text-4xl font-semibold">Reading chrome</h1>'
    + '<table className="text-sm"><thead><tr><th>Stage</th><th>Where</th><th>What happens</th></tr></thead><tbody>'
    + WIDE_ROW + WIDE_ROW + WIDE_ROW + '</tbody></table>'
    + section(1, 'The first claim') + section(2, 'The second claim') + section(3, 'The third claim') + section(4, 'The fourth claim')
    + '</article>';
  const PAGE = '<article data-design="tw" className="mx-auto max-w-2xl p-6"><h2>One</h2><p>a</p><h2>Two</h2><p>b</p></article>';
  const DECK = '<SlideDeck>' + [1, 2, 3, 4].map((n) => `<Slide title="S${n}"><h2>Slide ${n}</h2></Slide>`).join('') + '</SlideDeck>';

  async function publish(markup, template = 'editorial') {
    const st = await start();
    const res = await fetch(`${BASE}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({ markup, theme: 'industry', template }),
    });
    if (!res.ok) throw new Error(`PUT → ${res.status} ${await res.text()}`);
    return st;
  }

  /** The same document, published in dark mode — section 6 reads its rail. */
  async function publishDark(markup) {
    const st = await start();
    const res = await fetch(`${BASE}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({ markup, theme: 'industry', template: 'editorial', colorMode: 'dark' }),
    });
    if (!res.ok) throw new Error(`PUT → ${res.status} ${await res.text()}`);
    return st;
  }

  const doc = await publish(DOC);
  const page2 = await publish(PAGE);
  const deck = await publish(DECK, 'deck');

  // ── 1. desktop: the outline ────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    // First-paint geometry: sample the column's left edge from the earliest
    // paint and after settling. A moved sample is a layout shift.
    await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'domcontentloaded' });
    const frame = await documentFrame(page);
    const early = await frame.evaluate(() => document.querySelector('article')?.getBoundingClientRect().left ?? -1);
    const hasOutlineEarly = await frame.evaluate(() => !!document.querySelector('.mx-outline'));
    await page.waitForLoadState('networkidle');
    await sleep(800);
    const late = await inDoc(page, () => document.querySelector('article')?.getBoundingClientRect().left ?? -1);
    check(hasOutlineEarly, 'the outline is in the document on FIRST paint (server-rendered)');
    check(Math.abs(early - late) < 2, `the column did not move after paint (${early} → ${late})`);
    check(await inDoc(page, () => document.querySelectorAll('.mx-outline-row').length) === 4, 'one row per section');
    check(await inDoc(page, () => getComputedStyle(document.querySelector('.mx-outline')).display !== 'none'), 'the outline is visible at 1440');

    await documentLocator(page).getByLabel('Go to section 3: 3. The third claim').click();
    await sleep(900);
    const top = await inDoc(page, () => [...document.querySelectorAll('.mx-doc h2')][2].getBoundingClientRect().top);
    check(top >= -2 && top < 120, `clicking a row scrolled the section to the top (top=${Math.round(top)})`);
    const current = await inDoc(page, () => [...document.querySelectorAll('.mx-outline-row')].map((r) => r.getAttribute('aria-current')));
    check(current[2] === 'true' && current.filter(Boolean).length === 1, `the row for the section being read is current (${JSON.stringify(current)})`);

    // Not for a page, not for a deck, not for a capture.
    await page.goto(`${BASE}/a/${page2.id}`, { waitUntil: 'networkidle' });
    check(await inDoc(page, () => !document.querySelector('.mx-outline')), 'a two-heading page has no outline');
    await page.goto(`${BASE}/a/${deck.id}`, { waitUntil: 'networkidle' });
    check(await inDoc(page, () => !document.querySelector('.mx-outline') && !!document.querySelector('.mx-rail')), 'a deck keeps its slide rail and gets no outline');
    const capture = await fetch(`${BASE}/a/${doc.id}/raw?chrome=0`, { headers: { Authorization: `Bearer ${doc.token}` } }).then((r) => r.text());
    check(!capture.includes('mx-outline'), 'the capture render has no outline');
    await ctx.close();
  }

  // ── 2. phone: tables scroll inside the column, the page never does ─────────
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'networkidle' });
    await sleep(1000);
    check(await inDoc(page, () => getComputedStyle(document.querySelector('.mx-outline')).display === 'none'), 'the outline is hidden on a phone');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      && await inDoc(page, () => document.documentElement.scrollWidth <= innerWidth), 'the page does not scroll sideways (nor the document in its frame)');
    const t = await inDoc(page, () => {
      const t = document.querySelector('table');
      return { w: Math.round(t.getBoundingClientRect().width), col: Math.round(t.parentElement.getBoundingClientRect().width), overflows: t.scrollWidth > t.clientWidth, mark: t.getAttribute('data-mx-scrollable') };
    });
    check(t.w <= t.col, `the table is capped at its column (${t.w} ≤ ${t.col})`);
    check(t.overflows, 'a wide table scrolls INSIDE itself');
    check(t.mark === '', `and is marked scrollable so its edge fades (${JSON.stringify(t.mark)})`);
    await inDoc(page, () => { const t = document.querySelector('table'); t.scrollLeft = t.scrollWidth; t.dispatchEvent(new Event('scroll')); });
    await sleep(100);
    check(await inDoc(page, () => document.querySelector('table').getAttribute('data-mx-scrollable')) === 'end', 'the fade drops at the last column');
    await ctx.close();
  }

  // ── 3. desktop: the same table hugs its rows and does not widen the page ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'networkidle' });
    const t = await inDoc(page, () => {
      const t = document.querySelector('table');
      return { w: Math.round(t.getBoundingClientRect().width), col: Math.round(t.parentElement.getBoundingClientRect().width), display: getComputedStyle(t).display, mark: t.getAttribute('data-mx-scrollable') };
    });
    check(t.w <= t.col, `on a laptop the table stays inside its column (${t.w} ≤ ${t.col})`);
    check(t.mark === null, 'and carries no scroll mark when it fits');
    await ctx.close();
  }

  // ── 4. A LIVE UPDATE brings new sections and a new table ──────────────────
  //
  // The reading chrome is wired once, at load. An agent write re-renders the
  // document in place — so a section added afterwards must appear in the
  // outline AND be clickable, and a table added afterwards must scroll and say
  // so. A one-shot wiring left both dead, silently.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'networkidle' });
    await sleep(600);
    const before = await inDoc(page, () => document.querySelectorAll('.mx-outline-row').length);

    const grown = DOC.replace('</article>', `${section(5, 'Added by an agent')}<table className="text-sm"><thead><tr><th>Stage</th><th>Where</th><th>What happens</th></tr></thead><tbody>${WIDE_ROW}${WIDE_ROW}</tbody></table></article>`);
    const res = await fetch(`${BASE}/api/artifacts/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doc.token}` },
      body: JSON.stringify({ markup: grown, theme: 'industry', template: 'editorial' }),
    });
    check(res.ok, 'the agent write landed');

    const after = await until(async () => inDoc(page, () => document.querySelectorAll('.mx-outline-row').length), (n) => n === before + 1, 15000);
    check(after === before + 1, `the new section joined the outline live (${before} → ${after})`);

    // …and the new row actually navigates (the bug a one-shot wiring hides).
    //
    // Asserted as "the page moved and the heading is now IN VIEW", not "the
    // heading is at the top": this is the LAST section, so the scroll runs to
    // the bottom of the page and stops with the heading partway down — there is
    // no content below it left to scroll.
    // A no-runtime document RELOADS to show a live update and then holds the
    // reader's place while the layout settles — so this also proves that hold
    // yields (lib/story-runtime/anchor-restore): before the fix, the loop pulled
    // the page back from every click for four seconds.
    await sleep(1200);
    await inDoc(page, () => window.scrollTo(0, 0));
    await sleep(300);
    await documentLocator(page).getByLabel('Go to section 5: 5. Added by an agent').click();
    await sleep(1500);
    const nav = await inDoc(page, () => {
      const h = [...document.querySelectorAll('.mx-doc h2')][4];
      return { y: Math.round(scrollY), top: Math.round(h?.getBoundingClientRect().top ?? -9999), vh: innerHeight };
    });
    check(nav.y > 200, `the new row scrolled the page (scrollY=${nav.y})`);
    check(nav.top >= -2 && nav.top < nav.vh, `and brought the new section into view (top=${nav.top} of ${nav.vh})`);

    // …and the table that arrived with it is a marked scroll box on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(600);
    const marks = await until(
      async () => inDoc(page, () => [...document.querySelectorAll('table')].map((t) => t.getAttribute('data-mx-scrollable'))),
      (m) => Array.isArray(m) && m.length === 2 && m.every((x) => x === ''),
      10000,
    );
    check(Array.isArray(marks) && marks.length === 2 && marks.every((m) => m === ''), `both tables — the original and the live one — are marked scrollable (${JSON.stringify(marks)})`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      && await inDoc(page, () => document.documentElement.scrollWidth <= innerWidth), 'and the page still does not scroll sideways (nor the document in its frame)');
    await ctx.close();
  }

  // (Was "5. The EXPORT still renders": the og export PNG is the exports journey gate's.)

  // ── 6. THE RAIL IN DARK MODE — legibility is a number, so measure it ──────
  // The outline inherits the document's theme tokens the way the deck rail
  // does, which is why nothing here needed its own palette. But "inherits the
  // tokens" is not the same claim as "is readable on a dark ground", and only
  // one of those is what a reader gets. Contrast is measurable, so it is
  // asserted rather than assumed — including the current-section mark, which
  // carries the whole "you are here" signal and is the part a colour-only
  // check would miss.
  {
    const dark = await publishDark(DOC);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/a/${dark.id}`, { waitUntil: 'networkidle' });
    await sleep(600);
    const probe = await inDoc(page, () => {
      // Any CSS colour → rgb by letting the browser convert: the themes ship
      // oklch(), which no regex should be parsing.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const px = (v) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = v; cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      // The ground behind the rail: the nearest ancestor that actually paints.
      const ground = (el) => { let n = el; while (n) { const c = px(getComputedStyle(n).backgroundColor);
        if (c[3] > 0.5) return c; n = n.parentElement; } return [0, 0, 0, 1]; };
      const rows = [...document.querySelectorAll('.mx-outline-row')];
      if (!rows.length) return { rows: 0 };
      const cs = (el) => getComputedStyle(el);
      const bg = ground(rows[0]);
      const cur = rows.find((r) => r.getAttribute('aria-current') === 'true') ?? rows[0];
      const idle = rows.find((r) => r !== cur) ?? rows[0];
      return {
        rows: rows.length,
        isDark: document.querySelector("[data-mx-inline-story]:not([data-mx-initial-story])").classList.contains('dark'),
        bgLum: lum(bg),
        idle: ratio(px(cs(idle).color), bg),
        current: ratio(px(cs(cur).color), bg),
        label: ratio(px(cs(document.querySelector('.mx-outline-label')).color), bg),
        colourDiffers: cs(cur).color !== cs(idle).color,
        borderDiffers: cs(cur).borderLeftColor !== cs(idle).borderLeftColor,
      };
    });
    check(probe.rows === 4, `the rail renders in dark mode (${probe.rows} rows)`);
    check(probe.isDark === true, 'the document really is in dark mode');
    check(probe.bgLum < 0.2, `on a dark ground (luminance ${probe.bgLum?.toFixed(3)})`);
    check(probe.idle >= 3, `an idle row is legible (${probe.idle?.toFixed(2)}:1, need ≥3)`);
    check(probe.current >= 4.5, `the current row meets AA body text (${probe.current?.toFixed(2)}:1, need ≥4.5)`);
    check(probe.label >= 3, `the "Contents" label is legible (${probe.label?.toFixed(2)}:1)`);
    check(probe.colourDiffers || probe.borderDiffers, `"you are here" is visible (colour ${probe.colourDiffers}, border ${probe.borderDiffers})`);

    // And the reader's own controls: a light document flipped to dark keeps it.
    const lightDoc = await publish(DOC);
    await page.goto(`${BASE}/a/${lightDoc.id}`, { waitUntil: 'networkidle' });
    // The reader's colour choice is the app bar's controls panel, sent into the frame (solid/pages/Document chooseMode).
    await openArtifactControls(page);
    await page.getByLabel('Dark mode', {exact: true}).click();
    await sleep(400);
    check(await inDoc(page, () => document.querySelector("[data-mx-inline-story]:not([data-mx-initial-story])").classList.contains('dark')
      && getComputedStyle(document.querySelector('.mx-outline')).display !== 'none'),
      'and the reader\'s own dark toggle keeps the rail');
    await ctx.close();
  }
  // A passing run leaves nothing behind; a failing one leaves everything, so the documents it failed on can
  // still be opened.
  if (!check.failures.length) await cleanup();
});

// ── 3. the phone: chrome, a chart tooltip, a touch selection (was gate-mobile, its reader legs) ──
await section('phone', async () => {
  const B = BASE;
  const PHONE = { width: 390, height: 844 };

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

  // A second, PUBLIC document carrying a chart — the tooltip legs read it as a
  // stranger would (no session), so the chart is in the main frame with no shell.
  const CHART_ROWS = [
    { region: 'NA', revenue: 120 },
    { region: 'EU', revenue: 90 },
    { region: 'APAC', revenue: 70 },
  ];
  // An ARC: `buildTooltipPlan` returns null for it, so it keeps the per-mark
  // `#vg-tooltip-element` — the card the bug report named.
  const ARC_VIZ = '{"kind":"vega-lite","spec":{"mark":{"type":"arc","tooltip":true},'
    + '"encoding":{"theta":{"field":"revenue","type":"quantitative"},"color":{"field":"region","type":"nominal"}}}}';
  const chartMarkup = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(CHART_ROWS)}} /></Helmet>`
    + '<div data-design="tw" className="p-6"><h1 className="text-2xl font-bold">Revenue</h1>'
    + `<Question title="By region" data="$rows" height={240} viz={${ARC_VIZ}} />`
    + Array.from({ length: 30 }, (_, i) => `<p className="mt-4">A paragraph below the chart. ${i + 1}</p>`).join('')
    + '</div>';
  const chartDoc = await (await fetch(`${B}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    body: JSON.stringify({ title: 'mobile gate chart', markup: chartMarkup, theme: 'manuscript' }),
  })).json();


  const open = async (viewport, hash = '', id = st.id) => {
    const page = await browser.newPage({ viewport });
    // The shell belongs to the OWNER (a reader is served the bare document), and
    // ownership is the httpOnly session cookie now — not a localStorage token.
    await becomeOwner(page, B, st.token);
    await page.goto(`${B}/a/${id}${hash}`, { waitUntil: 'load' });
    return page;
  };

  /**
   * Does the contextual EDITOR bar overflow its own box? Reading has no bar.
   */
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

  phoneDocId = st.id;

  // ── 1. the viewer on a phone ───────────────────────────────────────────────
  const view = await open(PHONE);
  await view.waitForTimeout(2500);
  check(!(await overflows(view)), 'viewer: the page does not scroll sideways');
  /*
   * THE BAR IS THE APP PAGE'S OWN (solid/document/DocumentChrome), drawn above the document's frame and always on
   * screen. "The document carries the chrome" and its scroll rule (hidden on load, away on a downward scroll, back on a
   * reverse one) are retired with the reader chrome inside the document; what stays is that the bar draws its triggers.
   */
  check((await view.getByLabel('Open menu', {exact:true}).count()) === 1
    && (await view.getByLabel('Open artifact controls', {exact:true}).count()) === 1,
    'viewer: the app bar draws one menu and one artifact-controls trigger');

  // ── 2. the app menu on a phone ─────────────────────────────────────────────
  // Navigation folds out from the page's hamburger.
  await openMenu(view);
  await view.waitForSelector('[aria-label="Menu"]', { timeout: 10_000 });
  await view.waitForTimeout(300);
  const menu = await fitsAcross(view, 'Menu');
  check(menu.fits, `app menu: fits the screen (${menu.left}..${menu.right}px of ${menu.viewport}px)`);
  check(!(await overflows(view)), 'app menu: and opening it does not make the page scroll sideways');
  const clippedItems = await view.locator('[aria-label="Menu"]').evaluate(menu => {
    const w = document.documentElement.clientWidth;
    return [...menu.querySelectorAll('a, button')]
      .filter((el) => el.getBoundingClientRect().right > w + 1).length;
  });
  check(clippedItems === 0, `app menu: no item is cut off (${clippedItems} clipped)`);
  await view.keyboard.press('Escape');
  await openArtifactControls(view);
  await view.waitForSelector('[aria-label="Artifact controls"]');
  const controls = await fitsAcross(view, 'Artifact controls');
  check(controls.fits, `artifact controls: sheet fits the screen (${controls.left}..${controls.right}px of ${controls.viewport}px)`);
  check(!(await overflows(view)), 'artifact controls: and opening it does not make the page scroll sideways');
  // The reader's actions are the app bar's rail now (Like, Comment, Fork, Edit, Share and the triggers).
  const READER_ACTIONS = 'header[aria-label="Page bar"] button, header[aria-label="Page bar"] a';
  const sheetOverlap = await view.locator('section[aria-label="Artifact controls"]').evaluate((sheet, actions) => {
    const root = sheet.getRootNode();
    const bounds = sheet.getBoundingClientRect();
    const overlap = [...root.querySelectorAll(actions)].find(button => {
      const r = button.getBoundingClientRect();
      return r.width && r.height && r.x + r.width / 2 > bounds.left && r.x + r.width / 2 < bounds.right
        && r.y + r.height / 2 > bounds.top && r.y + r.height / 2 < bounds.bottom;
    });
    if (!overlap) return { overlapping: false, owns: true, actions: root.querySelectorAll(actions).length };
    const r = overlap.getBoundingClientRect();
    const hit = root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { overlapping: true, owns: sheet.contains(hit), actions: root.querySelectorAll(actions).length, hit: hit?.outerHTML.slice(0, 160) };
  }, READER_ACTIONS);
  check(sheetOverlap.owns, `artifact controls: the open sheet paints above overlapping reader actions (${JSON.stringify(sheetOverlap)})`);
  await view.close();

  // (Sections 3 and 4, the editor on a phone and the desktop theme popover, are the editor's: gate-editor-exits.)

  // ── 5. a chart tooltip must be dismissable with a finger ───────────────────
  /*
   * MEASURED FIRST, then written: headless
   * Chromium's touch emulation sends a stationary tap as pointerdown → pointerup →
   * pointerleave with NO pointermove, and Vega opens a tooltip on a MOVE — so an
   * emulated tap opens no card at all and cannot exercise this. A real finger is
   * never stationary; the touch legs therefore drive the mark with a synthetic
   * touch pointer sequence (the product's own handler, hit test and policy all
   * run for real, only the input is synthesised — the same compromise
   * gate-image-upload's dispatch legs make, beside its real-keystroke one). The
   * MOUSE leg below uses a real pointer, because that is the behaviour that must
   * not change.
   */
  const cardState = (page) => page.evaluate(() => {
    const el = document.getElementById('vg-tooltip-element');
    if (!el) return { present: false, shown: false, close: false };
    const cs = getComputedStyle(el);
    const close = el.querySelector('button[aria-label="Dismiss tooltip"]');
    return {
      present: true,
      shown: cs.visibility === 'visible' && cs.display !== 'none',
      close: !!close,
      // The card must stay transparent to the pointer; only the button is tappable.
      cardEvents: cs.pointerEvents,
      closeEvents: close ? getComputedStyle(close).pointerEvents : null,
    };
  });

  /** The centre of a drawn arc mark, in client coordinates. */
  const markPoint = (page) => page.evaluate(() => {
    const path = [...document.querySelectorAll('[aria-label="Question embed"] svg path')]
      .find((p) => p.__data__?.mark?.marktype === 'arc' && p.__data__?.datum);
    if (!path) return null;
    const r = path.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });

  /**
   * Open the card the way a finger does: LIFT the previous touch, then a touch pointer that moved
   * onto the mark. The lift matters — Vega calls the tooltip handler only when the hovered ITEM
   * changes, so re-touching the same mark while it still believes that mark is hovered opens
   * nothing (the measured tap log ends in `pointerleave`, which is exactly this).
   */
  const touchMark = (page) => page.evaluate(() => {
    const path = [...document.querySelectorAll('[aria-label="Question embed"] svg path')]
      .find((p) => p.__data__?.mark?.marktype === 'arc' && p.__data__?.datum);
    if (!path) return false;
    const r = path.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2) };
    const touch = { ...init, pointerType: 'touch', isPrimary: true };
    path.dispatchEvent(new PointerEvent('pointerout', touch));
    path.dispatchEvent(new PointerEvent('pointerleave', { ...touch, bubbles: false }));
    path.dispatchEvent(new MouseEvent('mouseout', init));
    path.dispatchEvent(new PointerEvent('pointerdown', touch));
    path.dispatchEvent(new PointerEvent('pointermove', touch));
    path.dispatchEvent(new MouseEvent('mousemove', init));
    return true;
  });

  /*
   * Poll, never sleep: CI runs the gates four browsers to a machine, and a fixed
   * wait is exactly what loses that race. The two states this leg turns on are
   * "the card is up" and "the card is gone", so wait for each of them by name.
   */
  const cardShown = (page, want) => page.waitForFunction(
    (w) => {
      const el = document.getElementById('vg-tooltip-element');
      const cs = el && getComputedStyle(el);
      return (!!cs && cs.visibility === 'visible' && cs.display !== 'none') === w;
    },
    want,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);

  // The first `path` to exist is an axis or a legend symbol; wait for a DRAWN ARC.
  const arcDrawn = (page) => page.waitForFunction(
    () => [...document.querySelectorAll('[aria-label="Question embed"] svg path')]
      .some((p) => p.__data__?.mark?.marktype === 'arc' && p.__data__?.datum),
    null,
    { timeout: 90_000 },
  ).then(() => true).catch(() => false);

  /*
   * The chart, its card and its scroll are the DOCUMENT's, inside the frame the app page draws (the frame is what
   * scrolls), so every helper above is handed the document's frame; a pointer or a tap is aimed in page coordinates,
   * the frame's offset added (`onPage`).
   */
  const onPage = async (page, point) => {
    const box = await page.locator(DOCUMENT_FRAME).boundingBox();
    return { x: point.x + (box?.x ?? 0), y: point.y + (box?.y ?? 0) };
  };
  const phone = await browser.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await phone.goto(`${B}/a/${chartDoc.id}`, { waitUntil: 'load' });
  const phoneDoc = await documentFrame(phone);
  check(await arcDrawn(phoneDoc), 'tooltip: the phone document draws an arc mark');

  check(await touchMark(phoneDoc), 'tooltip: the phone document draws an arc mark to touch');
  check(await cardShown(phoneDoc, true), 'tooltip: a touch opens the card');
  let tip = await cardState(phoneDoc);
  check(tip.shown, `tooltip: …and it is really up (${JSON.stringify(tip)})`);
  check(tip.close, 'tooltip: and a touch-opened card carries a close button');
  check(tip.cardEvents === 'none' && tip.closeEvents !== 'none',
    `tooltip: the card stays pointer-transparent, the button does not (${tip.cardEvents} / ${tip.closeEvents})`);

  await phoneDoc.evaluate(() => window.scrollBy(0, 300));
  check(await cardShown(phoneDoc, false), 'tooltip: scrolling the document puts it away');

  /*
   * …and the scroll back has to SETTLE before the next touch. A `scroll` event is delivered on a
   * later frame than the call that caused it, so scrolling and touching in the same breath opens
   * the card and then dismisses it with the scroll that is still in flight — the product working,
   * and a false red. Wait for 200ms of scroll silence, which is what a thumb does anyway.
   */
  const scrollSettled = (page, to) => page.evaluate((y) => new Promise((resolve) => {
    let timer = setTimeout(finish, 200);
    function finish() { window.removeEventListener('scroll', onScroll); resolve(); }
    function onScroll() { clearTimeout(timer); timer = setTimeout(finish, 200); }
    window.addEventListener('scroll', onScroll);
    window.scrollTo(0, y);
  }), to);

  await scrollSettled(phoneDoc, 0);
  await touchMark(phoneDoc);
  check(await cardShown(phoneDoc, true), 'tooltip: it opens again after the scroll');
  /*
   * A 26px button is a 26px THUMB TARGET, which is half of what a phone needs. The visual stays
   * 26px — a bigger dot would cover the card it sits on — and the TARGET is grown to 44×44 under
   * it. Both halves are checked: the declared area, and a real HIT TEST at all four corners 20px
   * out — inside the enlarged square, outside the drawn button, and (down-and-left) over the card
   * itself, which is `pointer-events: none` and would otherwise let the tap fall to the document.
   * Polled, like every other state this leg turns on, rather than sampled once.
   *
   * Everything here is measured IN THE PAGE, never through a Playwright locator: `boundingBox()`
   * scrolls its element into view, and a scroll is precisely what this feature dismisses on — so
   * asking Playwright where the button is could put the card away before the hit test looks.
   */
  const targetHittable = await phoneDoc.waitForFunction(() => {
    const b = document.querySelector('button[aria-label="Dismiss tooltip"]');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Every corner 20px out — inside the 44x44 target, outside the 26px button.
    return [[-20, -20], [20, -20], [-20, 20], [20, 20]].every(([dx, dy]) => {
      const el = document.elementFromPoint(cx + dx, cy + dy);
      return !!el && (el === b || b.contains(el));
    });
  }, null, { timeout: 15_000 }).then(() => true).catch(() => false);

  const target = await phoneDoc.evaluate(() => {
    const b = document.querySelector('button[aria-label="Dismiss tooltip"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const area = getComputedStyle(b, '::before');
    const at = (dx, dy) => {
      const el = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
      return el ? (el === b || b.contains(el) ? 'button' : el.tagName) : 'nothing';
    };
    return {
      visual: `${Math.round(r.width)}x${Math.round(r.height)}`,
      area: `${area.width}x${area.height}`,
      width: parseFloat(area.width), height: parseFloat(area.height),
      around: [at(-20, -20), at(20, -20), at(-20, 20), at(20, 20)].join(','),
      card: getComputedStyle(document.getElementById('vg-tooltip-element')).visibility,
      x: r.left + r.width / 2, y: r.top + r.height / 2,
    };
  });
  check(!!target && target.width >= 44 && target.height >= 44,
    `tooltip: the close button's tap target is at least 44x44 (${target ? `${target.area} around a ${target.visual} button` : 'missing'})`);
  check(targetHittable,
    `tooltip: and a tap 20px outside the drawn button still lands on it (corners ${target?.around}, card ${target?.card})`);
  // Tap 18px down-left of the centre: the enlarged target, NOT the drawn button.
  if (target) { const at = await onPage(phone, { x: target.x - 18, y: target.y + 18 }); await phone.touchscreen.tap(at.x, at.y); }
  check(await cardShown(phoneDoc, false), 'tooltip: and tapping it dismisses the card');
  await phone.close();

  // The same document with a MOUSE: desktop hover is untouched.
  const desk = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await desk.goto(`${B}/a/${chartDoc.id}`, { waitUntil: 'load' });
  const deskDoc = await documentFrame(desk);
  await arcDrawn(deskDoc);
  const inFrame = await markPoint(deskDoc);
  check(!!inFrame, 'tooltip: the desktop document draws an arc mark to hover');
  const point = inFrame ? await onPage(desk, inFrame) : { x: 0, y: 0 };
  const corner = await onPage(desk, { x: 4, y: 4 });
  await desk.mouse.move(point.x - 3, point.y - 3);
  await desk.mouse.move(point.x, point.y);
  check(await cardShown(deskDoc, true), 'tooltip: a real hover still opens the card');
  tip = await cardState(deskDoc);
  check(!tip.close, `tooltip: and a mouse-opened card carries NO close button (${JSON.stringify(tip)})`);
  await desk.mouse.move(corner.x, corner.y);
  check(await cardShown(deskDoc, false), 'tooltip: moving the cursor off the mark still closes it');
  await desk.close();

  /*
   * ── 7. the selection bubble on a TOUCH device ──────────────────────────────
   *
   * The bubble used to appear from `pointerup` or a selection key, and a touch
   * selection fires neither: Android takes the long-press over for its own
   * selection UI (the page sees `pointercancel` at best) and dragging the
   * handles is browser chrome the page never hears about. So on a phone the
   * owner's Edit/Annotate bubble was simply unreachable, while every desktop
   * check stayed green.
   *
   * Playwright cannot drive the native handles either, so the gesture is
   * reproduced by its RESULT — a Range set inside the frame plus the
   * `selectionchange` that a touch selection does fire, and no pointer event at
   * all. What the browser alone can answer is everything after that: the media
   * query the placement branches on, where the bubble lands against the last
   * line of real wrapped text, its size against a thumb, and whether tapping it
   * opens the composer.
   */
  const touch = await browser.newPage({ viewport: PHONE, hasTouch: true });
  await becomeOwner(touch, B, st.token);
  await touch.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
  const docFrame = await documentFrame(touch);
  await docFrame.waitForSelector('[data-mx-inline-story]', { timeout: 30_000 });
  await docFrame.waitForSelector('p', { timeout: 30_000 });

  // A coarse pointer is the whole premise: a leg that silently took the mouse
  // path would pass the "below the words" check by accident near the top of the
  // viewport and test nothing.
  check(await docFrame.evaluate(() => matchMedia('(pointer: coarse)').matches),
    'touch: the emulated phone reports a coarse pointer');

  /** The Range a touch selection leaves behind, and the one event it fires. */
  const touchSelect = () => docFrame.evaluate(() => {
    const paragraph = document.querySelectorAll('p')[2];
    const range = document.createRange();
    range.selectNodeContents(paragraph.firstChild);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const bubble = docFrame.locator('[data-mx-selection-actions]');
  // The capability grant and this tiny lazy chunk land a beat after the page, so
  // the gesture is repeated until it takes — the same reason gate-annotations
  // clicks in a loop.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await touchSelect();
    await touch.waitForTimeout(600);
    if (await bubble.isVisible().catch(() => false)) break;
  }
  check(await bubble.isVisible(), 'touch: the owner is offered the bubble on a phone at all');

  /*
   * …and now the module is WARM, which is the only way to ask the real question.
   * On the first grant it recovers a still-live Range once (the selection can
   * finish while the chunk is loading), so a bubble that appears above proves
   * nothing about touch. Collapse it, select again with no pointer event, and
   * only `selectionchange` is left to raise it.
   */
  await docFrame.evaluate(() => {
    getSelection().removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await touch.waitForTimeout(400);
  check(!(await bubble.isVisible().catch(() => false)), 'touch: collapsing the selection puts the bubble away at once');
  await touchSelect();
  let raised = false;
  for (let attempt = 0; attempt < 20 && !raised; attempt += 1) {
    await touch.waitForTimeout(250);
    raised = await bubble.isVisible().catch(() => false);
  }
  check(raised, 'touch: a selection that fires NO pointerup raises the bubble — selectionchange is all a touch gesture gives');

  const placed = await bubble.evaluate((surface) => {
    const box = surface.getBoundingClientRect();
    const lines = [...getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const last = lines.at(-1);
    return {
      top: box.top, bottom: box.bottom, left: box.left, right: box.right,
      lastBottom: last.bottom, lastTop: last.top, lines: lines.length,
      buttons: [...surface.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)),
      width: window.innerWidth, height: window.innerHeight,
    };
  });
  check(placed.top >= placed.lastBottom - 1,
    `touch: the bubble hangs BELOW the last line of the selection (top ${Math.round(placed.top)} vs line bottom ${Math.round(placed.lastBottom)}, ${placed.lines} lines)`);
  check(placed.bottom > placed.top && placed.right > placed.left
    && placed.top >= -1 && placed.bottom <= placed.height + 1 && placed.left >= -1 && placed.right <= placed.width + 1,
    `touch: the bubble is inside the viewport (${Math.round(placed.left)}..${Math.round(placed.right)} x ${Math.round(placed.top)}..${Math.round(placed.bottom)} of ${placed.width}x${placed.height})`);
  check(placed.buttons.length > 0 && placed.buttons.every((h) => h >= 44),
    `touch: every action is a 44px touch target (${placed.buttons.join(', ')}px)`);

  // "…and clear of the dock" is retired: the reader's controls are the app bar ABOVE the frame, outside the
  // document's viewport, so nothing at the foot of the screen can cover a bubble (selection-actions.ui.test.ts keeps
  // the frame-side clamp).

  // A tap, not a click: the whole point is the finger.
  await docFrame.locator('[aria-label="Comment on selected text"]').tap();
  const composer = await (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await touch.locator('[aria-label="Annotation comment"]').count() === 1) return true;
      await touch.waitForTimeout(250);
    }
    return false;
  })();
  check(composer, 'touch: tapping Comment opens the composer on those words');
  await touch.close();
});

// ── 4. a served chart and Vega's first draw agree (was gate-chart-width) ──
await section('chart width', async () => {
  const base = BASE;
  const started = await startDocument(base);
  const dataset = await fetch(`${base}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${started.token}` },
    body: JSON.stringify({ title: 'Chart width rows', visibility: 'unlisted', dataset: [
      { month: '2025-01-01', revenue: 120 }, { month: '2025-02-01', revenue: 160 }, { month: '2025-03-01', revenue: 90 },
    ] }),
  });
  if (!dataset.ok) throw new Error(`dataset ${dataset.status}: ${await dataset.text()}`);
  const datasetId = (await dataset.json()).id;
  const viz = '{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}';
  const query = `<Helmet><Import name="sales" src="ref:${datasetId}" /><Query name="monthly">{\`select month, revenue from sales.rows order by month\`}</Query></Helmet>`;
  const question = (id) => `<Question id="${id}" title="Revenue by month" data="$monthly" height="300px" viz={${viz}} />`;
  const documents = [
    { name: 'single', id: started.id, token: started.token, markup: `${query}<div data-design="tw" className="@container px-4 py-8 @2xl:px-8">${question('single-chart')}</div>`, widths: [1376] },
    { name: 'dashboard', ...await startDocument(base), markup: `${query}<div data-design="tw" className="@container px-4 py-8 @2xl:px-8"><Grid mode="flow"><GridItem w={6}>${question('left')}</GridItem><GridItem w={6}>${question('right')}</GridItem></Grid></div>`, widths: [682, 682] },
  ];
  for (const doc of documents) {
    const saved = await fetch(`${base}/api/artifacts/${doc.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doc.token}` },
      body: JSON.stringify({ markup: doc.markup, template: 'dashboard' }),
    });
    if (!saved.ok) throw new Error(`${doc.name} publish ${saved.status}: ${await saved.text()}`);
    const url = `${base}/a/${doc.id}`;
    const before = await browser.newPage({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    let served = [];
    for (let i = 0; i < 30; i++) {
      await before.goto(url, { waitUntil: 'domcontentloaded' });
      // The app page frames the document on its own origin (drawn by the server, so it loads without script too).
      const frame = await documentFrame(before);
      served = await frame.locator('[aria-label="Question embed"] svg.marks').evaluateAll((svgs) => svgs.map((svg) => ({
        width: Number(svg.getAttribute('width')),
        ticks: [...svg.querySelectorAll('.role-axis-label text')].map((label) => label.textContent),
      })));
      if (served.length === doc.widths.length) break;
      await before.waitForTimeout(200);
    }
    check(served.length === doc.widths.length, `${doc.name}: server drew every chart`);
    const after = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await after.goto(url, { waitUntil: 'domcontentloaded' });
    const afterDoc = await documentFrame(after);
    // The compiled controller mounts Vega's SVG directly in the slot (no vega-embed wrapper).
    await afterDoc.locator('[aria-label="Question embed"] svg.marks:not(.absolute)').first().waitFor({ timeout: 30000 });
    const drawn = await afterDoc.locator('[aria-label="Question embed"] svg.marks:not(.absolute)').evaluateAll((svgs) => svgs.map((svg) => ({
      width: Number(svg.getAttribute('width')),
      ticks: [...svg.querySelectorAll('.role-axis-label text')].map((label) => label.textContent),
      slot: Math.floor(svg.closest('[role="graphics-document"]').clientWidth),
    })));
    check(JSON.stringify(served.map((item) => item.width)) === JSON.stringify(doc.widths), `${doc.name}: served widths ${served.map((item) => item.width)} match ${doc.widths}`);
    check(JSON.stringify(drawn.map((item) => item.slot)) === JSON.stringify(doc.widths), `${doc.name}: measured slots match ${doc.widths}`);
    const sameTicks = JSON.stringify(served.map((item) => item.ticks)) === JSON.stringify(drawn.map((item) => item.ticks));
    if (!sameTicks) check.note(`${doc.name}: served ticks ${JSON.stringify(served.map((item) => item.ticks))}; Vega ticks ${JSON.stringify(drawn.map((item) => item.ticks))}`);
    check(sameTicks, `${doc.name}: axis ticks match before and after Vega`);
    await before.close();
    await after.close();
  }
});

// ── 5. the pages people open on a phone never scroll sideways (was gate-app-flows' MOBILE pages) ──
await section('no sideways scroll', async () => {
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  const overflow = () => horizontalOverflow(mp);
  for (const [label, url] of [['viewer', `/a/${phoneDocId}`], ['deck', `/a/${deckId}`], ['docs', '/docs'], ['login', '/login']]) {
    await mp.goto(`${BASE}${url}`, { waitUntil: 'load' });
    await mp.waitForTimeout(2000);
    check((await overflow()) <= 2, `${label}: no horizontal scroll`);
  }
  await mctx.close();
});

await browser.close();
check.done();
