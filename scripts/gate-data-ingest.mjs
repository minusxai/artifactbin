/**
 * Gate: a human uploads data, then a story references it and the chart renders.
 *
 * The two halves are individually unit-tested. What no unit test covers is the
 * SEAM — a dataset created through the browser, referenced by id from a story,
 * rendered through Vega with the uploaded values. That is the whole feature,
 * and it is the only place a coercion mistake becomes visible: a `revenue`
 * column left as text produces a chart that draws but is wrong.
 *
 *   usage: node scripts/gate-data-ingest.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const api = async (path, init = {}, token) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const CSV = 'month,revenue,zip\n2026-01,120,01234\n2026-02,150,09876\n2026-03,190,01234';

// The token rides the start LINK now, not the response body (lib/agent-session).
const start = await startDocument(BASE);
const token = start.token;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token. becomeOwner lands on the app's own origin, which is
// where this gate starts anyway.
await becomeOwner(page, BASE, token);

// ── 1. Upload a CSV (the API is the same ingest the signed-in form posts to;
// the form itself is unit-tested in dataset-upload.ui.test.tsx and no longer
// exists on the anonymous home page) ─────────────────────────────────────────
const made = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'sales', dataset: CSV }) }, token);
const datasetId = made.body.id ?? null;
check(!!datasetId, `the upload returns a usable reference (${made.body.ref})`);

// The coercion contract: revenue is a number, zip is not.
const columns = (made.body.columns ?? []).map((c) => `${c.name}:${c.type}`).join(' ');
check(/revenue:number/.test(columns), `revenue was coerced to a number (${columns})`);
check(/zip:string/.test(columns), 'zip kept its leading zero as text');

// The create response must TELL the agent how to consume the dataset — a bare
// id is not usable, and omitting the ref: prefix is exactly the mistake that
// shipped a blank chart.
check(made.body.ref === `ref:${made.body.id}`, `the create response carries the ref form (${made.body.ref})`);
check(/<Query name="rows">/.test(made.body.usage ?? '') && /data="\$rows"/.test(made.body.usage ?? ''), 'and a ready-to-paste Query + embed bound as data="$rows"');
check(/vega-lite/.test(made.body.usage ?? ''), 'with a viz spec bound to the real columns');

// ── 2. EDIT a story to reference the uploaded dataset ───────────────────────
// The editor writes through the same /edits protocol a human's typing does, so
// driving it by API here exercises the identical write path the UI uses.
const head = await api(`/api/artifacts/${start.id}`, {}, token);
const markup =
  `<Helmet><Query name="rows">{\`select * from ref_${datasetId}\`}</Query></Helmet>` +
  `<div data-design="tw" className="@container p-10">` +
  `<h1 className="text-4xl font-bold">Sales</h1>` +
  `<Question title="Revenue by month" data="$rows" ` +
  `viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"month","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} ` +
  `height="430px" /></div>`;
const put = await api(`/api/artifacts/${start.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Sales', markup, theme: 'modernist' }) }, token);
check(put.status === 200, `the story accepts a Query over the uploaded dataset (${put.status})`);

// ── 3. The chart renders, with the UPLOADED values ─────────────────────────
await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
await page.waitForTimeout(6000);
const surface = () => page.frames().find((f) => f !== page.mainFrame());
check(!!surface(), 'story surface mounted');

const marks = await surface().locator('svg.marks, canvas').count();
check(marks > 0, 'a real Vega chart rendered (not a fallback table)');

// The axis is built from the CSV's own headers and values — proof the chart is
// drawing THIS dataset rather than rendering empty.
const text = await surface().locator('body').innerText();
check(/2026-01/.test(text), 'the x axis carries values from the uploaded CSV');
check(/revenue/i.test(text), 'the y axis is labelled from the CSV header');

// A quantitative axis over a string column silently produces a flat/absent
// scale, so assert a tick only a numeric domain would produce.
check(/\b(150|190|200)\b/.test(text), 'the y scale is numeric — coercion survived into Vega');

// ── 3b. The rows are NOT in the database column ────────────────────────────
// The reason this feature exists: a large dataset must not sit in a column that
// every render and every /edits write reads and parses.
const stored = await api(`/api/artifacts/${datasetId}`, {}, token);
check(stored.status === 200, 'the dataset reads back through the API');
const rawRows = await (await fetch(`${BASE}/a/${(stored.body.url ?? '').split('/a/')[1] ?? ''}/raw`)).json().catch(() => null);
check(Array.isArray(rawRows) && rawRows.length === 3, `rows are served from wherever they live (${Array.isArray(rawRows) ? rawRows.length : 'none'} rows)`);
check(rawRows?.[0]?.zip === '01234', 'and the leading zero survived the round trip through storage');

// ── 4. The same, from a PUBLIC GOOGLE SHEET ────────────────────────────────
const sheet = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'From sheet', sheetUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0' }),
}, token);
check(sheet.status === 201, `a public sheet imports as a dataset (${sheet.status})`);
check((sheet.body.columns ?? []).length > 0, `with inferred columns (${(sheet.body.columns ?? []).map((c) => c.name).slice(0, 3).join(', ')})`);

// ── 5. A private sheet fails CLEANLY, never storing an HTML page ───────────
const priv = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'nope', sheetUrl: 'https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/edit' }),
}, token);
check(priv.status === 400 && priv.body.code === 'sheet_not_public', `a non-public sheet is refused (${priv.status} ${priv.body.code})`);

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall good');
process.exit(failures.length ? 1 : 0);
