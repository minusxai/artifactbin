/**
 * Gate: a deck's navigation chrome, which lives INSIDE the document — the
 * parent cannot reach into an opaque-origin frame, so the rail and present
 * bar are the document's own.
 *
 * What only a browser can prove:
 *   1. the rail is there on FIRST PAINT at its final width — it is
 *      server-rendered from the AST, so a deck never shifts sideways
 *      (the 0.11 CLS regression that scripts/gate-layout-shift.mjs exists for)
 *   2. clicking a rail row scrolls to that slide, and the active row follows
 *      the reader's scroll
 *   3. the present bar pages with the keyboard
 *   4. rail previews render the slide's own content (not empty boxes)
 *   5. the present bar clears the attribution footer at the end of the deck
 *   6. the CAPTURE render (?chrome=0, what /export screenshots) has no chrome
 *
 * usage: node scripts/gate-deck-chrome.mjs [base]   (default :3040)
 */
import { chromium } from 'playwright';
import { becomeOwner } from './lib/start-doc.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const mint = await mintAnon(BASE);
const publish = async (body) => {
  const res = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const DECK = `<Helmet><title>Deck gate</title></Helmet>
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

const deck = await publish({ markup: DECK });
console.log(`   deck: ${BASE}/a/${deck.id}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// /a/<id> serves the DOCUMENT to anyone but its owner, so a gate that drives
// the app shell (the frame, the rail, the present bar) must own it first.
await becomeOwner(page, BASE, mint.token);

// 1. no sideways shift: measure the document's left edge on first paint and again after hydration.
await page.goto(`${BASE}/a/${deck.id}`);
const frameEl = await page.waitForSelector('iframe[title="artifact"]', { timeout: 20000 });
const frame = await frameEl.contentFrame();
// SCOPED to the document column: the rail's previews are real <Slide>
// elements too (that is what makes them faithful), so an unscoped query
// measures a miniature — the same trap the runtime's own navigation hit.
const SLIDES = ".mx-doc [data-mx-slide]";
await frame.waitForSelector('.mx-doc [data-mx-slide]', { timeout: 20000 });
const firstLeft = await frame.evaluate(`document.querySelector('${SLIDES}').getBoundingClientRect().left`);
check(await frame.evaluate("!!document.querySelector('.mx-rail')"), 'the rail is in the served document');
await page.waitForTimeout(2500); // hydration well past
const afterLeft = await frame.evaluate(`document.querySelector('${SLIDES}').getBoundingClientRect().left`);
check(firstLeft === afterLeft, `the deck never shifts sideways on hydrate (${firstLeft} → ${afterLeft})`);
check(firstLeft >= 180, `the document sits beside a full-width rail (left=${firstLeft})`);

// 4. previews carry the slide's own content
check(await frame.evaluate("document.querySelector('.mx-rail-thumb')?.innerText.includes('The Cover Slide')"),
  'rail previews render the slide content');
// Text is the half that never broke. The rail is a render path of its own, and
// it shipped once with the text present and a HOLE where the icon goes —
// invisible to innerText, which is why that check passed through the bug.
check(await frame.evaluate("!!document.querySelector('.mx-rail-thumb svg')"),
  'rail previews draw the slide\'s icons too (server-resolved glyphs reach the rail)');
check(await frame.evaluate("[...document.querySelectorAll('.mx-rail-row')].length === 3"), 'one rail row per slide');

// 2. click-to-navigate + active tracking
await frame.click('[aria-label="Go to slide 3: Close"]');
await page.waitForTimeout(1500);
const atThird = await frame.evaluate(
  `Math.abs(document.querySelectorAll('${SLIDES}')[2].getBoundingClientRect().top) < 60`,
);
check(atThird, 'clicking a rail row scrolls to that slide');
await page.waitForTimeout(500);
check(await frame.evaluate("document.querySelectorAll('.mx-rail-row')[2].getAttribute('aria-current') === 'true'"),
  'the active row follows the reader');

// 3. keyboard paging through the present bar
await frame.click('[aria-label="Go to slide 1: Cover"]');
await page.waitForTimeout(1200);
await frame.evaluate("document.querySelector('.mx-present').scrollIntoView()");
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1500);
check(await frame.evaluate(`Math.abs(document.querySelectorAll('${SLIDES}')[1].getBoundingClientRect().top) < 60`),
  'ArrowRight pages to the next slide');
check(await frame.evaluate("document.querySelector('[aria-label=\"Slide position\"]').innerText.trim() === '2 / 3'"),
  'the counter tracks position');

/*
 * 5. RETIRED. The present bar used to yield to a credits footer that followed
 * the document in normal flow; the footer is gone (lib/story/reader-chrome —
 * the author is the byline, the host is the logo, provenance is in the
 * settings panel), so there is nothing left for the bar to clear.
 */

// 6. the capture render carries no chrome
const bare = await (await fetch(`${BASE}/a/${deck.id}/raw?chrome=0`)).text();
check(!bare.includes('Slide controls') && !bare.includes('mx-rail'), 'the capture render (?chrome=0) has no chrome');
check(bare.includes('The Cover Slide'), 'and still carries the document');

await browser.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall deck-chrome checks passed');
