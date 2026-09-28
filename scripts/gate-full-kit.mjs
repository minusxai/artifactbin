import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Gate: the WHOLE component kit through the unified pipeline — the
 * kitchen-sink document served as the
 * SSR'd sandboxed document and hydrated by the in-frame runtime.
 *
 * This is the breadth check the tracer slice deliberately did not make. What
 * only a browser can prove:
 *   1. every kit component paints, and the interactive ones HYDRATE (tabs,
 *      accordion, collapsible) rather than being dead server markup
 *   2. the embeds resolve their `ref:` data from the island — charts draw,
 *      inline numbers compute, params filter — with NO network
 *   3. zero CSP violations, zero page errors, and no request to any host but
 *      our own: the document phones nobody
 *   4. the platform font actually resolves INSIDE the opaque frame (the
 *      check that looks like success while failing — the parent's preload is
 *      useless across a cache partition, so the document preloads its own)
 *
 * usage: node scripts/gate-full-kit.mjs [base]   (default :3040)
 */
import { chromium } from 'playwright';
import { becomeOwner } from './lib/start-doc.mjs';
import { kitchenSinkMarkup } from './lib/kitchen-sink-doc.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { compiledReader, readerUrl } from './lib/gate-reader.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const origin = new URL(BASE).origin;
const check = createChecker('full-kit');

const mint = await connectAgent(BASE);
const publish = async (body) => {
  const res = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

// The kitchen sink's refs, then the document itself (lib/kitchen-sink-doc).
const markup = await kitchenSinkMarkup(publish);

const doc = await publish({ markup, theme: 'modernist', colorMode: 'dark', title: 'Kitchen sink (unified)' });
console.log(`   doc: ${BASE}/a/${doc.id}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
// Login visits Home, whose showcase thumbnails can finish loading after its
// DOM is ready. Close that page so its requests cannot enter the document gate.
const loginPage = await context.newPage();
await becomeOwner(loginPage, BASE, mint.token);
await loginPage.close();
const page = await context.newPage();
// The vendor document is deterministic here; the separate widget gate exercises
// its sandboxed fetch and popup behavior. No fixture enters the running app.
await page.route(/^https:\/\/buttons\.github\.io\/buttons\.html(?:\?|$)/, route => route.fulfill({ contentType: 'text/html', body: '<a href="https://github.com/minusxai/artifactbin" target="_blank">Star</a>' }));

const external = [];
const requests = [];
const pageErrors = [];
const requestChecks = [];
page.on('request', (r) => {
  const u = r.url();
  requests.push(u);
  // Only our fixed, response-sandboxed widget document is exempt. Inspect its
  // URL synchronously: SSR hydration can detach its frame element before the
  // asynchronous DOM inspection finishes. Other frames remain network-closed.
  if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) requestChecks.push((async () => {
    const frameUrl = new URL(r.frame().url());
    const trustedWidget = frameUrl.origin === origin && frameUrl.pathname === '/-/github-star'
      && (u === 'https://buttons.github.io/buttons.js' || u === 'https://api.github.com/repos/minusxai/artifactbin');
    if (!trustedWidget) external.push(u);
  })());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
});

await page.goto(readerUrl(`${BASE}/a/${doc.id}`));
const frameEl = await page.waitForSelector('[data-mx-inline-story]', { timeout: 30000 });
const frame = page.mainFrame();
await frame.waitForSelector('h1', { timeout: 30000 });
await page.waitForTimeout(6000); // charts hydrate and draw

// 1. breadth: every family painted
const text = await frame.evaluate('document.body.innerText');
for (const marker of [
  'The Kitchen Sink', 'Card title', 'Heads up', 'Tab one', 'Accordion section A',
  'Toggle details', 'Definition term', 'A deck inside the gallery', 'Grid-hosted chart',
  // The <File> card's own text: the file's name and the facts under it.
  'kit paper', '2 pages',
]) check(text.includes(marker), `renders: ${marker}`);

// interactive components are HYDRATED, not dead markup
await frame.click('text=Open dialog');
await frame.waitForSelector('[aria-label="Kitchen sink dialog"][open]');
check((await frame.textContent('[aria-label="Kitchen sink dialog"]')).includes('Dialog content opened from the gallery.'), 'Dialog hydrated');
await frame.locator('[aria-label="Kitchen sink dialog"]').getByRole('button', { name: 'Close', exact: true }).click();
await frame.waitForSelector('[aria-label="Kitchen sink dialog"]:not([open])', { state: 'attached' });
await frame.click('text=Tab two');
await page.waitForTimeout(600);
check((await frame.evaluate('document.body.innerText')).includes('Second pane content'), 'Tabs hydrated');
await frame.click('text=Accordion section B');
await page.waitForTimeout(600);
check((await frame.evaluate('document.body.innerText')).includes('Collapsed until clicked'), 'Accordion hydrated');

/*
 * <Icon> is the one kit component with NO text of its own, so the marker sweep
 * above cannot see it: it draws a glyph the SERVER resolved into the island
 * (lib/story/icon-glyphs), and if that resolution ever misses, the icon renders
 * as nothing at all while every other check here still passes. So look at the
 * glyph itself — present, carrying its paths, and actually laid out.
 */
const icons = await frame.evaluate(`(() => {
  const els = [...document.querySelectorAll('svg.lucide')];
  return {
    count: els.length,
    withPaths: els.filter((e) => e.children.length > 0).length,
    laidOut: els.filter((e) => e.getBoundingClientRect().width > 0).length,
  };
})()`);
check(icons.count > 0, `<Icon> drew its glyph (${icons.count})`);
// Both counts against a NON-ZERO total, or they read 0/0 and pass vacuously
// on the exact failure the check above exists to catch.
check(icons.count > 0 && icons.withPaths === icons.count, `every glyph carries its paths (${icons.withPaths}/${icons.count})`);
check(icons.count > 0 && icons.laidOut === icons.count, `every glyph is laid out (${icons.laidOut}/${icons.count})`);

// 2. embeds resolved from the island
check(await frame.evaluate("document.querySelectorAll('canvas, svg.marks').length > 0"), 'charts drew from island data');
check(/\$\s?[\d,]+/.test(text), 'inline <Number> computed a value');
check(await frame.evaluate("!!document.querySelector('[aria-label=\"Question embed\"]')"), 'Question embeds mounted');

// video renders as a click-to-open card: hosted poster, play badge, a link to
// the watch page — and NEVER a nested frame (the sandbox would kill a player).
check(await frame.evaluate("!!document.querySelector('[data-slot=\"video\"] a[href^=\"https://www.youtube.com/watch\"]')"), 'Video card links to the watch page');
check(await frame.evaluate("(document.querySelector('[data-slot=\"video-thumb\"]')?.getAttribute('src') ?? '').startsWith('/a/')"), 'Video poster resolved to the hosted image ref');
const managed = frame.locator('iframe[title="Isolated gallery region"]');
await frame.waitForSelector('iframe[title="Isolated gallery region"][data-mx-author-ready]');
check(await frame.locator('[data-mx-inline-story] iframe').count() === 1
  && await managed.getAttribute('sandbox') === 'allow-scripts'
  && await managed.getAttribute('src') === `${origin}/story/author-frame`,
  'only the managed opaque gallery wrapper is framed; Video remains a link');

// 3. isolation
const csp = await frame.evaluate('window.__csp || []');
await Promise.all(requestChecks);
check(csp.length === 0, `no CSP violations${csp.length ? `: ${csp.join(', ')}` : ''}`);
check(external.length === 0, `no external requests${external.length ? `: ${external.slice(0, 3).map(value => { const url = new URL(value); return url.origin + url.pathname; }).join(', ')}` : ''}`);
check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);

// 3b. the chart module is LAZY: a prose document must not download it
//     (vega is ~1 MB; the old reader bundle kept it behind a dynamic import
//     and the unified document must not regress that).
// The compiled page draws its charts on the server and loads Vega only when a chart must be drawn in the
// browser — its rows changed, or the reader reaches for it (docs/phase2-architecture.md §2.4). So on the
// compiled leg the positive control is that interaction: the chart module arrives as an island chunk then,
// not before, and the chart is redrawn by it.
const islandChunks = () => requests.filter((u) => new URL(u).pathname.startsWith('/islands/'));
if (compiledReader) {
  const before = islandChunks().length;
  // The first chart the server drew (its drawing fills the box: lib/islands/chart DRAWING_CLASS), reached for.
  const served = frame.locator('[data-mx-chart-state="ready"]:has(> svg.absolute.inset-0)').first();
  await served.evaluate((el) => { el.dataset.gateReached = '1'; }).catch(() => {});
  await served.hover().catch(() => {});
  const drawn = await frame.waitForFunction(() => { const el = document.querySelector('[data-gate-reached]'); return !!el && el.getAttribute('data-mx-chart-state') === 'ready' && !el.querySelector(':scope > svg.absolute.inset-0') && !!el.querySelector('canvas, svg'); }, null, { timeout: 20000 }).then(() => true, () => false);
  check(drawn, `a chart document drew with the lazy chart module once the reader reached for a chart (${islandChunks().length - before} island chunks after the reach)`);
} else check(requests.some((u) => /\/(?:story\/chunks\/|assets\/)?VegaChart[-.]/.test(u) || /\/VegaChart\.tsx(?:\?|$)/.test(u)), 'a chart document fetched the lazy chart chunk');

// 4. the font resolved INSIDE the opaque frame
const fontOk = await frame.evaluate(async () => {
  await document.fonts.ready;
  const body = getComputedStyle(document.body).fontFamily;
  const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  return { body, loaded };
});
check(fontOk.loaded.length > 0, `a platform face loaded inside the frame (${fontOk.loaded.slice(0, 3).join(', ') || 'none'})`);

// 5. The EXPORT path, which only a running server can exercise: the exporter
//    navigates the served document, so these assertions moved here from
//    __tests__/export.test.ts when the html tier's hermetic render retired.
const png = await fetch(`${BASE}/a/${doc.id}/export?format=png`);
const pngBytes = Buffer.from(await png.arrayBuffer());
check(png.status === 200 && png.headers.get('content-type') === 'image/png', `export renders PNG (${png.status})`);
check(pngBytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'export bytes are a real PNG');
check(pngBytes.length > 1000, `export is a non-trivial image (${pngBytes.length} bytes)`);

const jpg = await fetch(`${BASE}/a/${doc.id}/export?format=jpg`);
const jpgBytes = Buffer.from(await jpg.arrayBuffer());
check(jpgBytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'export renders JPEG on request');

const card = await fetch(`${BASE}/a/${doc.id}/export?format=png&mode=card`);
const cardBytes = Buffer.from(await card.arrayBuffer());
const size = (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
check(JSON.stringify(size(cardBytes)) === JSON.stringify({ width: 1600, height: 840 }),
  `mode=card crops to the og ratio (${JSON.stringify(size(cardBytes))})`);
check(size(pngBytes).height !== 840, 'the default capture is the full page, not the card');

// Version-keyed: a repeat fetch is byte-identical (memory + object store).
const again = Buffer.from(await (await fetch(`${BASE}/a/${doc.id}/export?format=png`)).arrayBuffer());
check(again.equals(pngBytes), 'a repeat export serves the stored render, byte for byte');

// The capture must not contain the document's own chrome.
check(!(await (await fetch(readerUrl(`${BASE}/a/${doc.id}/raw?chrome=0`))).text()).includes('Slide controls'),
  'the capture render carries no navigation chrome');

// A prose document (no embeds) must not pay for the chart module at all.
const prose = await publish({ markup: '<Helmet><title>Prose</title></Helmet><h1 className="text-4xl">Just words</h1><p>No charts here.</p>' });
const proseRequests = [];
const prosePage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await becomeOwner(prosePage, BASE, mint.token); // a fresh context owns nothing
prosePage.on('request', (r) => proseRequests.push(r.url()));
await prosePage.goto(readerUrl(`${BASE}/a/${prose.id}`));
const proseFrame = await artifactDocument(prosePage);
await proseFrame.waitForSelector('h1', { timeout: 20000 });
await prosePage.waitForTimeout(3000);
if (compiledReader) {
  // A compiled prose page loads its own behaviour (@mx/page) and nothing of the islands' runtime or charts.
  const manifest = await (await fetch(`${BASE}/islands/manifest.json`)).json();
  const closure = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u) || !manifest.files[u]) continue; seen.add(u); closure(manifest.files[u].imports, seen); } return seen; };
  const allowed = closure([manifest.manifest['@mx/page']]);
  const extra = proseRequests.map((u) => new URL(u).pathname).filter((p) => p.startsWith('/islands/') && !allowed.has(p));
  check(extra.length === 0, `a prose document never fetches the chart chunk (island files beyond its page behaviour: ${extra.join(', ') || 'none'})`);
} else check(!proseRequests.some((u) => /\/(?:story\/chunks\/|assets\/)?VegaChart[-.]/.test(u) || /\/VegaChart\.tsx(?:\?|$)/.test(u)), 'a prose document never fetches the chart chunk');

await browser.close();
check.done();
