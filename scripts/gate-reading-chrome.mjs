/**
 * Gate: THE READING CHROME, in a real browser at two widths.
 *
 * Two things a reader of a long document gets that no unit test can see:
 *
 *   1. A TABLE OF CONTENTS beside a sectioned editorial — there on first paint
 *      at its final width (no column jump), marking the section being read,
 *      taking the reader to a section on click; gone on a phone, gone from a
 *      capture, and never beside a deck.
 *   2. TABLES THAT NEVER WIDEN THE PAGE — a 3-column table inside a phone
 *      column scrolls inside itself, says so with a faded edge, and drops the
 *      fade once the reader reaches the last column. The page never scrolls
 *      sideways.
 *
 *   usage: node scripts/gate-reading-chrome.mjs [base]
 */
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

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

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const WIDE_ROW = '<tr><td>Storage</td><td><code>lib/story/dataset-store.ts</code></td><td>One content-addressed JSON blob; the row keeps meta.objectKey, columns, rowCount. Capped at ten thousand rows, which is plenty for a poll.</td></tr>';
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
const browser = await chromium.launch();

// ── 1. desktop: the outline ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // First-paint geometry: sample the column's left edge from the earliest
  // paint and after settling. A moved sample is a layout shift.
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => document.querySelector('article')?.getBoundingClientRect().left ?? -1);
  const hasOutlineEarly = await page.evaluate(() => !!document.querySelector('.mx-outline'));
  await page.waitForLoadState('networkidle');
  await sleep(800);
  const late = await page.evaluate(() => document.querySelector('article')?.getBoundingClientRect().left ?? -1);
  ok(hasOutlineEarly, 'the outline is in the document on FIRST paint (server-rendered)');
  ok(Math.abs(early - late) < 2, `the column did not move after paint (${early} → ${late})`);
  ok(await page.evaluate(() => document.querySelectorAll('.mx-outline-row').length) === 4, 'one row per section');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.mx-outline')).display !== 'none'), 'the outline is visible at 1440');

  await page.getByLabel('Go to section 3: 3. The third claim').click();
  await sleep(900);
  const top = await page.evaluate(() => [...document.querySelectorAll('.mx-doc h2')][2].getBoundingClientRect().top);
  ok(top >= -2 && top < 120, `clicking a row scrolled the section to the top (top=${Math.round(top)})`);
  const current = await page.evaluate(() => [...document.querySelectorAll('.mx-outline-row')].map((r) => r.getAttribute('aria-current')));
  ok(current[2] === 'true' && current.filter(Boolean).length === 1, `the row for the section being read is current (${JSON.stringify(current)})`);

  // Not for a page, not for a deck, not for a capture.
  await page.goto(`${BASE}/a/${page2.id}`, { waitUntil: 'networkidle' });
  ok(await page.evaluate(() => !document.querySelector('.mx-outline')), 'a two-heading page has no outline');
  await page.goto(`${BASE}/a/${deck.id}`, { waitUntil: 'networkidle' });
  ok(await page.evaluate(() => !document.querySelector('.mx-outline') && !!document.querySelector('.mx-rail')), 'a deck keeps its slide rail and gets no outline');
  const capture = await fetch(`${BASE}/a/${doc.id}/raw?chrome=0`, { headers: { Authorization: `Bearer ${doc.token}` } }).then((r) => r.text());
  ok(!capture.includes('mx-outline'), 'the capture render has no outline');
  await ctx.close();
}

// ── 2. phone: tables scroll inside the column, the page never does ─────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'networkidle' });
  await sleep(1000);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.mx-outline')).display === 'none'), 'the outline is hidden on a phone');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the page does not scroll sideways');
  const t = await page.evaluate(() => {
    const t = document.querySelector('table');
    return { w: Math.round(t.getBoundingClientRect().width), col: Math.round(t.parentElement.getBoundingClientRect().width), overflows: t.scrollWidth > t.clientWidth, mark: t.getAttribute('data-mx-scrollable') };
  });
  ok(t.w <= t.col, `the table is capped at its column (${t.w} ≤ ${t.col})`);
  ok(t.overflows, 'a wide table scrolls INSIDE itself');
  ok(t.mark === '', `and is marked scrollable so its edge fades (${JSON.stringify(t.mark)})`);
  await page.evaluate(() => { const t = document.querySelector('table'); t.scrollLeft = t.scrollWidth; t.dispatchEvent(new Event('scroll')); });
  await sleep(100);
  ok(await page.evaluate(() => document.querySelector('table').getAttribute('data-mx-scrollable')) === 'end', 'the fade drops at the last column');
  await ctx.close();
}

// ── 3. desktop: the same table hugs its rows and does not widen the page ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'networkidle' });
  const t = await page.evaluate(() => {
    const t = document.querySelector('table');
    return { w: Math.round(t.getBoundingClientRect().width), col: Math.round(t.parentElement.getBoundingClientRect().width), display: getComputedStyle(t).display, mark: t.getAttribute('data-mx-scrollable') };
  });
  ok(t.w <= t.col, `on a laptop the table stays inside its column (${t.w} ≤ ${t.col})`);
  ok(t.mark === null, 'and carries no scroll mark when it fits');
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
  const before = await page.evaluate(() => document.querySelectorAll('.mx-outline-row').length);

  const grown = DOC.replace('</article>', `${section(5, 'Added by an agent')}<table className="text-sm"><thead><tr><th>Stage</th><th>Where</th><th>What happens</th></tr></thead><tbody>${WIDE_ROW}${WIDE_ROW}</tbody></table></article>`);
  const res = await fetch(`${BASE}/api/artifacts/${doc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doc.token}` },
    body: JSON.stringify({ markup: grown, theme: 'industry', template: 'editorial' }),
  });
  ok(res.ok, 'the agent write landed');

  const after = await until(async () => page.evaluate(() => document.querySelectorAll('.mx-outline-row').length), (n) => n === before + 1, 15000);
  ok(after === before + 1, `the new section joined the outline live (${before} → ${after})`);

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.getByLabel('Go to section 5: 5. Added by an agent').click();
  await sleep(1500);
  const nav = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.mx-doc h2')][4];
    return { y: Math.round(scrollY), top: Math.round(h?.getBoundingClientRect().top ?? -9999), vh: innerHeight };
  });
  ok(nav.y > 200, `the new row scrolled the page (scrollY=${nav.y})`);
  ok(nav.top >= -2 && nav.top < nav.vh, `and brought the new section into view (top=${nav.top} of ${nav.vh})`);

  // …and the table that arrived with it is a marked scroll box on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  const marks = await until(
    async () => page.evaluate(() => [...document.querySelectorAll('table')].map((t) => t.getAttribute('data-mx-scrollable'))),
    (m) => Array.isArray(m) && m.length === 2 && m.every((x) => x === ''),
    10000,
  );
  ok(Array.isArray(marks) && marks.length === 2 && marks.every((m) => m === ''), `both tables — the original and the live one — are marked scrollable (${JSON.stringify(marks)})`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'and the page still does not scroll sideways');
  await ctx.close();
}

// ── 5. The EXPORT still renders (tables are display:block now) ────────────
{
  const res = await fetch(`${BASE}/a/${doc.id}/export`, { headers: { Authorization: `Bearer ${doc.token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  ok(res.ok && buf.length > 5000, `the og export still renders (${res.status}, ${buf.length} bytes)`);
  ok(buf.subarray(0, 4).toString('hex') === '89504e47', 'and is real PNG bytes');
}

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
  const probe = await page.evaluate(() => {
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
      isDark: document.documentElement.classList.contains('dark'),
      bgLum: lum(bg),
      idle: ratio(px(cs(idle).color), bg),
      current: ratio(px(cs(cur).color), bg),
      label: ratio(px(cs(document.querySelector('.mx-outline-label')).color), bg),
      colourDiffers: cs(cur).color !== cs(idle).color,
      borderDiffers: cs(cur).borderLeftColor !== cs(idle).borderLeftColor,
    };
  });
  ok(probe.rows === 4, `the rail renders in dark mode (${probe.rows} rows)`);
  ok(probe.isDark === true, 'the document really is in dark mode');
  ok(probe.bgLum < 0.2, `on a dark ground (luminance ${probe.bgLum?.toFixed(3)})`);
  ok(probe.idle >= 3, `an idle row is legible (${probe.idle?.toFixed(2)}:1, need ≥3)`);
  ok(probe.current >= 4.5, `the current row meets AA body text (${probe.current?.toFixed(2)}:1, need ≥4.5)`);
  ok(probe.label >= 3, `the "Contents" label is legible (${probe.label?.toFixed(2)}:1)`);
  ok(probe.colourDiffers || probe.borderDiffers, `"you are here" is visible (colour ${probe.colourDiffers}, border ${probe.borderDiffers})`);

  // And the reader's own controls: a light document flipped to dark keeps it.
  const lightDoc = await publish(DOC);
  await page.goto(`${BASE}/a/${lightDoc.id}`, { waitUntil: 'networkidle' });
  await page.click('[data-mx-reader-trigger="controls"]');
  await page.click('[data-mx-mode-choice="dark"]');
  await sleep(400);
  ok(await page.evaluate(() => document.documentElement.classList.contains('dark')
    && getComputedStyle(document.querySelector('.mx-outline')).display !== 'none'),
    'and the reader\'s own dark toggle keeps the rail');
  await ctx.close();
}

await browser.close();
// A passing run leaves nothing behind; a failing one leaves everything, so
// the documents it failed on can still be opened.
if (!failures.length) await cleanup();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall ok');
process.exit(failures.length ? 1 : 0);
