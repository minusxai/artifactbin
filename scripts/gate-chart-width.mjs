/** A served chart and Vega's first draw use the same slot geometry and axis ticks. */
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { startDocument } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('chart-width');
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
const browser = await chromium.launch();
try {
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
      served = await before.locator('[aria-label="Question embed"] svg.marks').evaluateAll((svgs) => svgs.map((svg) => ({
        width: Number(svg.getAttribute('width')),
        ticks: [...svg.querySelectorAll('.role-axis-label text')].map((label) => label.textContent),
      })));
      if (served.length === doc.widths.length) break;
      await before.waitForTimeout(200);
    }
    check(served.length === doc.widths.length, `${doc.name}: server drew every chart`);
    const after = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await after.goto(url, { waitUntil: 'domcontentloaded' });
    // The compiled controller mounts Vega's SVG directly in the slot (no vega-embed wrapper).
    await after.locator('[aria-label="Question embed"] svg.marks:not(.absolute)').first().waitFor({ timeout: 30000 });
    const drawn = await after.locator('[aria-label="Question embed"] svg.marks:not(.absolute)').evaluateAll((svgs) => svgs.map((svg) => ({
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
} finally {
  await browser.close();
}
check.done();
