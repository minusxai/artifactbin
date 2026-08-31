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
import { execFileSync } from 'child_process';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const origin = new URL(BASE).origin;
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const mint = await (await fetch(`${BASE}/api/tokens/anonymous`, { method: 'POST' })).json();
const publish = async (body) => {
  const res = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

// The kitchen sink's three refs, then the document itself, built from the
// SOURCE OF TRUTH: lib/story/kitchen-sink.ts.
const dataset = await publish({
  title: 'kit rows',
  dataset: [
    { month: '2026-01-01', region: 'NA', revenue: 120 },
    { month: '2026-02-01', region: 'NA', revenue: 160 },
    { month: '2026-01-01', region: 'EU', revenue: 90 },
    { month: '2026-02-01', region: 'EU', revenue: 140 },
    { month: '2026-01-01', region: 'APAC', revenue: 70 },
    { month: '2026-02-01', region: 'APAC', revenue: 110 },
  ],
});
const recipe = await publish({
  title: 'kit recipe',
  viz: {
    description: 'Line by series',
    engine: 'vega-lite',
    bindings: [
      { name: 'x', label: 'X', accepts: ['nominal', 'temporal'] },
      { name: 'y', label: 'Y', accepts: ['quantitative'] },
      { name: 'series', label: 'Series', accepts: ['nominal'] },
    ],
    template: {
      mark: 'line',
      encoding: {
        x: { field: '{{x}}', type: '{{x:kind}}' },
        y: { field: '{{y}}', type: 'quantitative' },
        color: { field: '{{series}}', type: 'nominal' },
      },
    },
  },
});
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const image = await publish({ title: 'kit image', image: `data:image/png;base64,${PNG}` });

// The kitchen sink comes from the MODULE, not from slicing its source: it is
// the registry drift gate's definition of "every component", and a hand-rolled
// unescape of its template literal breaks the moment a nested backtick appears.
const markup = execFileSync('npx', ['tsx', '-e',
  `import { kitchenSinkMarkup } from './services/app/lib/story/kitchen-sink.ts';` +
  `process.stdout.write(kitchenSinkMarkup(${JSON.stringify({ dataset: dataset.id, recipe: recipe.id, image: image.id })}));`,
], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });

const doc = await publish({ markup, theme: 'modernist', colorMode: 'dark', title: 'Kitchen sink (unified)' });
console.log(`   doc: ${BASE}/a/${doc.id}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
// The shell (and its frame) belongs to the owner; readers get the document.
await becomeOwner(page, BASE, mint.token);

const external = [];
const requests = [];
const pageErrors = [];
page.on('request', (r) => {
  const u = r.url();
  requests.push(u);
  // <Video> is a click-to-open card now — the document loads NOTHING
  // third-party, so every external request is a stray.
  if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
});

await page.goto(`${BASE}/a/${doc.id}`);
const frameEl = await page.waitForSelector('iframe[title="artifact"]', { timeout: 30000 });
const frame = await frameEl.contentFrame();
await frame.waitForSelector('h1', { timeout: 30000 });
await page.waitForTimeout(6000); // charts hydrate and draw

// 1. breadth: every family painted
const text = await frame.evaluate('document.body.innerText');
for (const marker of [
  'The Kitchen Sink', 'Card title', 'Heads up', 'Tab one', 'Accordion section A',
  'Toggle details', 'Definition term', 'A deck inside the gallery', 'Grid-hosted chart',
]) check(text.includes(marker), `renders: ${marker}`);

// interactive components are HYDRATED, not dead markup
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
check(await frame.evaluate("document.querySelectorAll('iframe').length === 0"), 'the document contains no nested frames');

// 3. isolation
const csp = await frame.evaluate('window.__csp || []');
check(csp.length === 0, `no CSP violations${csp.length ? `: ${csp.join(', ')}` : ''}`);
check(external.length === 0, `no external requests${external.length ? `: ${external.slice(0, 3).join(', ')}` : ''}`);
check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);

// 3b. the chart module is LAZY: a prose document must not download it
//     (vega is ~1 MB; the old reader bundle kept it behind a dynamic import
//     and the unified document must not regress that).
check(requests.some((u) => /\/story\/chunks\/VegaChart-/.test(u)), 'a chart document fetched the lazy chart chunk');

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
check(!(await (await fetch(`${BASE}/a/${doc.id}/raw?chrome=0`)).text()).includes('Slide controls'),
  'the capture render carries no navigation chrome');

// A prose document (no embeds) must not pay for the chart module at all.
const prose = await publish({ markup: '<Helmet><title>Prose</title></Helmet><h1 className="text-4xl">Just words</h1><p>No charts here.</p>' });
const proseRequests = [];
const prosePage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await becomeOwner(prosePage, BASE, mint.token); // a fresh context owns nothing
prosePage.on('request', (r) => proseRequests.push(r.url()));
await prosePage.goto(`${BASE}/a/${prose.id}`);
const proseFrame = await (await prosePage.waitForSelector('iframe[title="artifact"]')).contentFrame();
await proseFrame.waitForSelector('h1', { timeout: 20000 });
await prosePage.waitForTimeout(3000);
check(!proseRequests.some((u) => /\/story\/chunks\/VegaChart-/.test(u)), 'a prose document never fetches the chart chunk');

await browser.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall full-kit checks passed');
