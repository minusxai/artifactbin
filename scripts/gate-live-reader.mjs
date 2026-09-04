/**
 * Gate: A SHARED LINK IS LIVE.
 *
 * Hand someone a link and let an agent write — the whole product. It did not
 * work: a reader is served the document itself, top-level, and the live stream
 * belonged to the app's page, which a reader never gets. They sat on the
 * version they loaded until they reloaded by hand, and nothing anywhere said
 * so.
 *
 * Two documents, because they take different routes to the same promise: one
 * with a chart (it hydrates, so it re-renders itself in place) and one of pure
 * prose (it ships no runtime at all, so it reloads — keeping the reader's
 * place across it, which is the only thing a reload would cost).
 *
 *   usage: node scripts/gate-live-reader.mjs [base]
 */
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';
import { revealReaderChrome } from './lib/reveal-chrome.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };
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

const browser = await chromium.launch();

// ── 1. A document that hydrates: adopted in place ───────────────────────────
{
  const doc = await publish(withChart('the first version'));
  // A READER: a fresh context, no session, nothing but the link.
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  let reloads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads++; });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => /the first version/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  ok(!(await page.evaluate(() => !!document.querySelector('iframe[title="artifact"]'))), 'the reader gets the document itself, not the app shell');
  await sleep(3000);

  // Where they are, and what they are looking at.
  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
  await sleep(800);
  const before = await page.evaluate(() => ({
    y: window.scrollY,
    chart: (() => { const el = document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas'); if (el) el.__probe = 'keep'; return !!el; })(),
    navigations: 0,
  }));
  const loadsBefore = reloads;

  await doc.write(withChart('THE AGENT REWROTE THIS'));
  await page.waitForFunction(() => /THE AGENT REWROTE THIS/.test(document.body.textContent ?? ''), null, { timeout: 25000 })
    .catch(() => {});
  await sleep(1500);

  const after = await page.evaluate(() => ({
    text: document.body.textContent ?? '',
    y: window.scrollY,
    chartKept: document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas')?.__probe ?? null,
  }));
  ok(/THE AGENT REWROTE THIS/.test(after.text), "the reader sees the agent's write, with no reload of their own");
  ok(reloads === loadsBefore, `and the page was never navigated to do it (${reloads - loadsBefore})`);
  ok(before.chart && after.chartKept === 'keep', 'the chart kept its rendered element through the update');
  ok(Math.abs(after.y - before.y) < 60, `and the reader kept their place (${before.y} → ${after.y})`);
  await ctx.close();
}

// ── 2. A document that hydrates nothing: reloaded, place kept ───────────────
{
  const doc = await publish(prose('the first version'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => /the first version/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  await sleep(2000);
  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
  await sleep(800);
  const before = await page.evaluate(() => window.scrollY);

  await doc.write(prose('THE AGENT REWROTE THIS TOO'));
  await page.waitForFunction(() => /THE AGENT REWROTE THIS TOO/.test(document.body.textContent ?? ''), null, { timeout: 25000 })
    .catch(() => {});
  await sleep(2500);
  const after = await page.evaluate(() => ({ text: document.body.textContent ?? '', y: window.scrollY }));
  ok(/THE AGENT REWROTE THIS TOO/.test(after.text), 'a prose document reaches its reader too');
  ok(Math.abs(after.y - before) < 120, `and the reload kept their place (${before} → ${after.y})`);
  await ctx.close();
}

// ── 3. The reader's mode override outlives the author's writes ──────────────
{
  const doc = await publish(withChart('mode probe'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => /mode probe/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  await sleep(2500);
  ok(await page.evaluate(() => document.documentElement.classList.contains('light')), 'an unthemed document opens in the author default (light)');
  // The reader's chrome opens hidden; a scroll up is the gesture that reveals it.
  await revealReaderChrome(page);
  await page.click('[data-mx-reader-trigger="controls"]');
  await page.click('[data-mx-mode-choice="dark"]');
  ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'the top-right toggle flips the document dark');

  await doc.write(withChart('MODE WRITE LANDED'));
  await page.waitForFunction(() => /MODE WRITE LANDED/.test(document.body.textContent ?? ''), null, { timeout: 25000 })
    .catch(() => {});
  await sleep(1200);
  ok(await page.evaluate(() => document.documentElement.classList.contains('dark')),
    "an agent write updates the document but does not stomp the reader's mode");
  await ctx.close();
}

// ── 4. …and survives the reload a no-runtime document delivers edits by ─────
{
  const doc = await publish(prose('mode prose probe'));
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => /mode prose probe/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  await sleep(2000);
  await revealReaderChrome(page);
  await page.click('[data-mx-reader-trigger="controls"]');
  await page.click('[data-mx-mode-choice="dark"]');

  await doc.write(prose('MODE PROSE REWRITTEN'));
  await page.waitForFunction(() => /MODE PROSE REWRITTEN/.test(document.body.textContent ?? ''), null, { timeout: 25000 })
    .catch(() => {});
  await sleep(2000);
  ok(await page.evaluate(() => document.documentElement.classList.contains('dark')),
    "a no-runtime document's reload carries the reader's mode in window.name");
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
  ok(res.status === 404, `an unknown document's stream is the uniform 404 (${res.status})`);
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall live-reader checks passed');
process.exit(failures.length ? 1 : 0);
