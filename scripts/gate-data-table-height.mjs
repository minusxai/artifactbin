/**
 * Gate: `<DataTable height>` is a CEILING, measured in a real browser.
 *
 * Production eval run 33702277600 (2026-09-03) showed every agent's report with
 * ~250px of empty box under a three-row table: the runtime wrapped the table in
 * a div of a fixed height and the box filled it. The fix makes the height a cap
 * — a short table hugs its rows, a long one scrolls inside the cap — and that
 * claim is exactly the kind jsdom cannot judge: it has no layout, so
 * `clientHeight` is 0, the virtual regime never turns on, and a unit test can
 * only pin the STYLE, never the geometry. So this gate measures the geometry:
 *
 *   1. a 3-row table's scroll box is shorter than its cap and does not scroll
 *      (scrollHeight === clientHeight — nothing is reserved below the rows);
 *   2. a 500-row table's box is exactly its cap and DOES scroll past it;
 *   3. scrolled to the bottom, the cap-only box still virtualises: rows are
 *      rendered and the last one is the tail of the dataset.
 *
 *   usage: node scripts/gate-data-table-height.mjs [base]
 */
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL'} ${label}`); if (!ok) failures.push(label); };

const CAP = 420;
const SHORT_ROWS = 3;
const LONG_ROWS = 500;
const LAST_LABEL = `row-${LONG_ROWS - 1}`;

const start = await startDocument(BASE);
const H = { Authorization: `Bearer ${start.token}`, 'Content-Type': 'application/json' };
const api = async (path, body, method = 'POST') => {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return parsed;
};

const rows = (n) => Array.from({ length: n }, (_, i) => ({ label: `row-${i}`, n: i }));
const short = await api('/api/artifacts', { dataset: rows(SHORT_ROWS) });
const long = await api('/api/artifacts', { dataset: rows(LONG_ROWS) });
check(!!short.id && !!long.id, `both datasets published (${short.id}, ${long.id})`);

const markup = `<Helmet><title>DataTable height gate</title>
<Query name="few">{\`select label, n from ref_${short.id} order by n\`}</Query>
<Query name="many">{\`select label, n from ref_${long.id} order by n\`}</Query>
</Helmet><div data-design="tw" className="p-8"><h1 className="text-2xl font-bold">Table height</h1>
<div id="short"><DataTable data="$few" /></div>
<div id="long"><DataTable data="$many" height={${CAP}} /></div></div>`;
await api(`/api/artifacts/${start.id}`, { title: 'DataTable height gate', markup }, 'PUT');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// A public data document is served TOP-LEVEL to anyone but its owner, so the
// boxes are measured on the main frame — no iframe to reach through.
await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
await page.waitForSelector('#long [data-slot="data-table"]', { timeout: 20000 });
// Paint first: the rows arrive a round trip after the document does.
await page.waitForFunction(
  (last) => (document.querySelector('#short tbody')?.textContent ?? '').includes('row-2')
    && (document.querySelector('#long tbody')?.querySelectorAll('tr').length ?? 0) > 5
    && !(document.querySelector('#long tbody')?.textContent ?? '').includes(last),
  LAST_LABEL,
  { timeout: 20000 },
).catch(() => {});

const box = (id) => `#${id} [data-slot="data-table"] > div`;
const measured = await page.evaluate((sel) => {
  const read = (q) => {
    const el = document.querySelector(q);
    return el ? { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight } : null;
  };
  return { short: read(sel.short), long: read(sel.long) };
}, { short: box('short'), long: box('long') });
console.log(JSON.stringify(measured, null, 1));

check(measured.short !== null && measured.long !== null, 'both scroll boxes are in the document');
check(
  measured.short.clientHeight > 0 && measured.short.clientHeight < 200,
  `a ${SHORT_ROWS}-row table hugs its rows (clientHeight=${measured.short.clientHeight} < 200, cap ${CAP})`,
);
check(
  measured.short.scrollHeight === measured.short.clientHeight,
  `…and reserves nothing below them (scrollHeight=${measured.short.scrollHeight} === clientHeight=${measured.short.clientHeight})`,
);
check(
  measured.long.clientHeight === CAP,
  `a ${LONG_ROWS}-row table stops AT the cap (clientHeight=${measured.long.clientHeight} === ${CAP})`,
);
check(
  measured.long.scrollHeight > CAP,
  `…and scrolls inside it (scrollHeight=${measured.long.scrollHeight} > ${CAP})`,
);

// The cap-only box must still be the virtualizer's scroll element: scroll to
// the end and the window must follow, all the way to the dataset's last row.
await page.evaluate((q) => { const el = document.querySelector(q); el.scrollTop = el.scrollHeight; }, box('long'));
await page.waitForFunction(
  (args) => (document.querySelector(`${args.q} tbody`)?.textContent ?? '').includes(args.last),
  { q: box('long'), last: LAST_LABEL },
  { timeout: 10000 },
).catch(() => {});
const tail = await page.evaluate((q) => {
  const body = document.querySelector(`${q} tbody`);
  const trs = [...(body?.querySelectorAll('tr') ?? [])];
  const el = document.querySelector(q);
  return {
    rendered: trs.length,
    lastRowText: trs.at(-1)?.textContent ?? null,
    scrolledTo: Math.round(el.scrollTop),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
}, box('long'));
console.log(JSON.stringify(tail, null, 1));

check(tail.rendered > 0, `rows are still rendered at the bottom of a cap-only box (${tail.rendered} <tr>)`);
check(
  tail.rendered < LONG_ROWS,
  `and it is still VIRTUAL — the DOM holds a window, not the table (${tail.rendered} of ${LONG_ROWS})`,
);
check(
  (tail.lastRowText ?? '').includes(LAST_LABEL),
  `the last rendered row is the dataset's tail (${JSON.stringify(tail.lastRowText)} contains ${LAST_LABEL})`,
);
check(tail.clientHeight === CAP, `the cap held through the scroll (clientHeight=${tail.clientHeight})`);
check(pageErrors.length === 0, `no page errors (${pageErrors.length}${pageErrors.length ? `: ${pageErrors[0]}` : ''})`);

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall good');
process.exit(failures.length ? 1 : 0);
