/**
 * Gate: A SHARED LINK IS LIVE.
 *
 * Hand someone a link and let an agent write — the whole product. The reader
 * gets the app page, which frames the document on its own origin; the document
 * holds its own live stream there, so a write reaches them without a reload of
 * their own.
 *
 * Two documents, because they take different routes to the same promise: one
 * with a chart (it hydrates, so it re-renders itself in place) and one of pure
 * prose (the former reader shipped it no runtime, so it reloaded — keeping the
 * reader's place across it, which is the only thing a reload would cost). The
 * compiled reader draws both in place (lib/islands/live-update): the page is
 * never navigated and a chart keeps its element.
 *
 *   usage: node scripts/gates/gate-live-reader.mjs [base]
 */
import { documentFrame } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { startDocument } from '../lib/start-doc.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('live-reader');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHART = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}}';
const filler = Array.from({ length: 40 }, (_, i) => `<p id="f${i}">filler paragraph ${i}, long enough that this document scrolls a good way past the fold.</p>`).join('');

const withChart = (lede) =>
  '<Helmet><Value name="rows" type="table" value={[{"x":"a","y":1},{"x":"b","y":3}]} /></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + `<h1 id="h">Live</h1><p id="lede">${lede}</p>`
  + `<Question data="$rows" height={300} viz={${CHART}} />${filler}</div>`;

const prose = (lede) =>
  `<div data-design="tw" className="p-10"><h1 id="h">Prose</h1><p id="lede">${lede}</p>${filler}</div>`;

async function publish(markup) {
  const start = await startDocument(BASE);
  const res = await fetch(`${BASE}/api/artifacts/${start.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${start.token}` },
    body: JSON.stringify({ markup }),
  });
  if (!res.ok) throw new Error(`PUT → ${res.status} ${await res.text()}`);
  return { ...start, write: (next) => fetch(`${BASE}/api/artifacts/${start.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${start.token}` },
    body: JSON.stringify({ markup: next }),
  }) };
}

/*
 * The document is framed by the app page on its own origin (lib/serving/document-frame); it scrolls inside its
 * frame and holds its own live stream. Every read below is of the document's frame, re-found each time: a
 * document that reloads to take a write is a new Frame, and a held one would be detached.
 */
const docEval = async (page, fn, arg) => (await documentFrame(page, { timeout: 5000 })).evaluate(fn, arg);
/** Wait until the document's text matches `re`; true when it did. */
async function docText(page, re, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await docEval(page, () => document.body?.textContent ?? '').catch(() => '');
    if (re.test(text)) return true;
    await sleep(200);
  }
  return false;
}
const STORY = '[data-mx-inline-story]:not([data-mx-initial-story])';
const storyHas = (page, cls) => docEval(page, ([sel, c]) => !!document.querySelector(sel)?.classList.contains(c), [STORY, cls]).catch(() => false);
/** Wait (briefly) for the story element to carry `cls`: the app page's choice reaches the frame by postMessage. */
async function storyBecomes(page, cls, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await storyHas(page, cls)) return true; await sleep(150); }
  return storyHas(page, cls);
}

const browser = await launchChromium();

// ── 1. A document that hydrates: adopted in place ───────────────────────────
{
  const doc = await publish(withChart('the first version'));
  // A READER: a fresh context, no session, nothing but the link.
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  let reloads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads++; });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  if (!await docText(page, /the first version/, 20000)) throw new Error('the reader never saw the first version');
  // "the reader gets the document itself, not the app shell" is gone: the app page frames every document on its own origin.
  await sleep(3000);

  // Where they are, and what they are looking at.
  await docEval(page, () => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
  await sleep(800);
  const before = await docEval(page, () => ({
    y: window.scrollY,
    chart: (() => { const el = document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas'); if (el) el.__probe = 'keep'; return !!el; })(),
    navigations: 0,
  }));
  const loadsBefore = reloads;

  await doc.write(withChart('THE AGENT REWROTE THIS'));
  await docText(page, /THE AGENT REWROTE THIS/, 25000);
  await sleep(1500);

  const after = await docEval(page, () => ({
    text: document.body.textContent ?? '',
    y: window.scrollY,
    chartKept: document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas')?.__probe ?? null,
  }));
  check(/THE AGENT REWROTE THIS/.test(after.text), "the reader sees the agent's write, with no reload of their own");
  // The compiled reader draws the new version in place: the page by morphing its
  // served story into the new version's (lib/islands/live-update), an unchanged island left running.
  check(reloads === loadsBefore, `and the page was never navigated to do it (${reloads - loadsBefore})`);
  check(before.chart && after.chartKept === 'keep', 'the chart kept its rendered element through the update');
  check(Math.abs(after.y - before.y) < 60, `and the reader kept their place (${before.y} → ${after.y})`);
  await ctx.close();
}

// ── 2. A document that hydrates nothing: reloaded, place kept ───────────────
{
  const doc = await publish(prose('the first version'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  if (!await docText(page, /the first version/, 20000)) throw new Error('the prose reader never saw the first version');
  await sleep(2000);
  await docEval(page, () => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
  await sleep(800);
  const before = await docEval(page, () => window.scrollY);

  await doc.write(prose('THE AGENT REWROTE THIS TOO'));
  await docText(page, /THE AGENT REWROTE THIS TOO/, 25000);
  await sleep(2500);
  const after = await docEval(page, () => ({ text: document.body.textContent ?? '', y: window.scrollY }));
  check(/THE AGENT REWROTE THIS TOO/.test(after.text), 'a prose document reaches its reader too');
  check(Math.abs(after.y - before) < 120, `and the reload kept their place (${before} → ${after.y})`);
  await ctx.close();
}

// ── 3. The reader's mode override outlives the author's writes ──────────────
{
  const doc = await publish(withChart('mode probe'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  if (!await docText(page, /mode probe/, 20000)) throw new Error('the reader never saw the mode probe');
  await sleep(2500);
  check(await storyHas(page, 'light'), 'an unthemed document opens in the author default (light)');
  // The app page's bar is always on screen (solid/document/DocumentChrome): nothing to reveal first.
  await openArtifactControls(page);
  await page.getByLabel('Dark mode', {exact: true}).click();
  check(await storyBecomes(page, 'dark'), 'the top-right toggle flips the document dark');

  await doc.write(withChart('MODE WRITE LANDED'));
  await docText(page, /MODE WRITE LANDED/, 25000);
  await sleep(1200);
  check(await storyHas(page, 'dark'), "an agent write updates the document but does not stomp the reader's mode");
  await ctx.close();
}

// ── 4. …and survives the reload a no-runtime document delivers edits by ─────
{
  const doc = await publish(prose('mode prose probe'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  if (!await docText(page, /mode prose probe/, 20000)) throw new Error('the reader never saw the prose mode probe');
  await sleep(2000);
  await openArtifactControls(page);
  await page.getByLabel('Dark mode', {exact: true}).click();
  await storyBecomes(page, 'dark');

  await doc.write(prose('MODE PROSE REWRITTEN'));
  await docText(page, /MODE PROSE REWRITTEN/, 25000);
  await sleep(2000);
  check(await storyHas(page, 'dark'), "a no-runtime document's reload carries the reader's mode in window.name");
  await ctx.close();
}

// ── 5. A private document tells a stranger nothing ──────────────────────────
{
  const doc = await publish(prose('secret'));
  await fetch(`${BASE}/api/artifacts/${doc.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doc.token}` },
    body: JSON.stringify({ visibility: 'unlisted' }),
  }).catch(() => {});
  const res = await fetch(`${BASE}/a/doesnotexist/events`);
  check(res.status === 404, `an unknown document's stream is the uniform 404 (${res.status})`);
}

await browser.close();
check.done();
