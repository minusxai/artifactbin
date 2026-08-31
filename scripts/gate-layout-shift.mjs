/**
 * Gate: a deck must not shove its own document sideways after it opens.
 *
 * The fault this pins: the birds-eye rail is a 190px flex SIBLING of the
 * canvas, and slides are discovered by polling the built iframe — so the
 * document painted at the far left, then jumped right a poll tick later, under
 * the reader's eyes, on every load of every deck (and again on entering edit
 * mode). Nothing in the unit suite can see it: jsdom has no layout.
 *
 * The same instrument answers the SIDEWAYS question (leg 5), which is the same
 * kind of fault one axis over: a deck built from the guidance we ship must not
 * be able to scroll horizontally, because the rail is `position: sticky` and
 * sticky only sticks vertically — a document that overflows by a pixel drags
 * its own navigation off the screen.
 *
 * Measured the way a reader experiences it — the canvas's own left edge,
 * sampled from the first paint through settling. A single moved sample is the
 * bug. The browser's layout-shift entries are collected too, because that is
 * the metric this maps onto (CLS) and it catches a jump this poll might blink
 * past.
 *
 *   usage: node scripts/gate-layout-shift.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

const slide = (n) => `<Slide title="Slide ${n}"><h1 className="text-5xl font-bold">Heading ${n}</h1>`
  + `<p className="mt-4 text-lg">Body copy for slide ${n}.</p></Slide>`;
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

const browser = await chromium.launch();

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
    const name = (n) => (n?.getAttribute?.('aria-label') ?? n?.tagName?.toLowerCase?.() ?? '?');
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__shifts.push({ value: e.value, sources: (e.sources || []).map((s) => name(s.node)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${B}/a/${id}${edit ? '#edit' : ''}`, { waitUntil: 'commit' });
  // Edit mode adds a bar around the document; wait for it before taping, so
  // what is measured is the document settling rather than the bar arriving.
  // The top bar's edit control becomes the exit while editing (ArtifactSurface).
  if (edit) await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });


  /*
   * Both modes measure the DOCUMENT, because there is only one.
   *
   * Edit mode used to measure the page: the 0.11 CLS this gate exists for came
   * from a second canvas and a parent-side rail appearing there. Neither
   * exists now — entering edit is a message to the document already on screen
   * — so what is worth asserting is that the document itself does not move.
   */
  const target = await (await page.waitForSelector('iframe[title="artifact"]', { timeout: 60_000 })).contentFrame();
  // `attached`, not `visible`: the rail's previews are scaled to a few pixels,
  // so the first matching element is legitimately not "visible" to Playwright.
  await target.waitForSelector('[data-mx-story-root]', { state: 'attached', timeout: 60_000 });

  const samples = await target.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 160; i++) { // ~8s, well past any late arrival
      // Ordered by preference, not by a selector list: a list returns whatever
      // comes first in the DOM, and the story root (the body) always would.
      const el = document.querySelector('.mx-doc')

        ?? document.querySelector('[data-mx-story-root]');
      if (el) {
        const x = Math.round(el.getBoundingClientRect().left);
        if (seen[seen.length - 1] !== x) seen.push(x);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const moved = (s) => s === 'Slide overview' || s === 'Slides' || s === 'div';
    const shifts = window.__shifts ?? [];
    const blamed = shifts.filter((x) => x.sources.some(moved));
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

// ── 1. a deck: the rail is there from the start and nothing moves ──────────
const deck = await mint(DECK);
const d = await watchCanvas(deck.id, { token: deck.token });
ok(d.railEntries >= 2, `deck: the rail did arrive (${d.railEntries} entries) — otherwise this proves nothing`);
ok(d.seen.length === 1, `deck: the document's left edge never moves (positions seen: ${d.seen.join(' -> ')})`);
ok(d.railShift === 0, `deck: nothing shifts the canvas or the rail (attributed CLS ${d.railShift.toFixed(4)})`);
console.log(`       (page CLS ${d.shifts.toFixed(4)} — the remainder is the footer settling as the canvas gets its height, which predates this gate)`);

// ── 2. entering edit mode is the same page, and must behave the same ───────
const e = await watchCanvas(deck.id, { edit: true, token: deck.token });
// Same guard as the view case: without proving the rail actually turned up,
// "it never moved" is what a page with no rail at all also reports.
ok(e.railEntries >= 2, `edit mode: the rail is there too (${e.railEntries} entries)`);
ok(e.seen.length === 1, `edit mode: the document's left edge never moves (positions seen: ${e.seen.join(' -> ')})`);

// ── 3. an ordinary document must not pay for the deck's column ─────────────
const plain = await mint(PLAIN);
const p = await watchCanvas(plain.id, { token: plain.token });
ok(p.railEntries === 0, 'plain: no rail, as before');
ok(p.seen.length === 1, `plain: and it still does not move (positions seen: ${p.seen.join(' -> ')})`);
// The reserved column is for DECKS only: an ordinary document that indents
// itself by 190px for a rail it will never show is a different bug with the
// same shape.
ok(p.seen[0] < d.seen[0], `plain: and sits further left than a deck (${p.seen[0]}px vs ${d.seen[0]}px)`);

// ── 4. mobile: the rail is an xl-and-up affordance, and must stay one ──────
// A reserved column that leaked below the breakpoint would indent every phone
// reader by 190px for a rail their screen never shows.
const m = await watchCanvas(deck.id, { token: deck.token, width: 390 });
ok(m.railEntries === 0 || m.railHidden, 'mobile: no rail column on a phone-width viewport');
ok(m.seen.length === 1, `mobile: and the document never moves (positions seen: ${m.seen.join(' -> ')})`);
ok(m.seen[0] < 40, `mobile: the document uses the full width (left edge ${m.seen[0]}px)`);

// ── 5. a deck built from our own guidance must not scroll sideways ────────
/*
 * Measured INSIDE the frame, where the document's own scrollport is: the page
 * around it has its own width and would answer a different question.
 */
async function measureBleed(id, token, width = 1600) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await becomeOwner(page, B, token);
  await page.goto(`${B}/a/${id}`, { waitUntil: 'commit' });
  const target = await (await page.waitForSelector('iframe[title="artifact"]', { timeout: 60_000 })).contentFrame();
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
const b = await measureBleed(bleedDeck.id, bleedDeck.token);
ok(b.railWidth > 0 && b.bleedLeft !== null,
  `bleed: the rail and the full-bleed slide are both there (rail ${b.railWidth}px) — otherwise this proves nothing`);
ok(b.overflow === 0, `bleed: the deck does not scroll sideways (${b.overflow}px of horizontal overflow)`);
// The point of the idiom is edge-to-edge WITHIN the column. Landing left of it
// is the same 24px seen from the other end: blue paint on top of the rail.
ok(b.bleedLeft >= b.columnLeft, `bleed: the slide stays out of the rail (slide left ${b.bleedLeft}px vs column ${b.columnLeft}px)`);
ok(b.bleedRight <= b.columnRight, `bleed: and inside the column's right edge (slide right ${b.bleedRight}px vs column ${b.columnRight}px)`);

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
const mm = await measureBleed(mismatch.id, mismatch.token);
ok(mm.bleedLeft !== null, 'mismatch: the overshooting element is there — otherwise this proves nothing');
ok(mm.overflow === 0, `mismatch: the document still does not scroll sideways (${mm.overflow}px of horizontal overflow)`);

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
