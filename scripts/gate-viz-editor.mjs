/**
 * Gate: building a chart by clicking, in a real browser.
 *
 * The unit and jsdom tests cover every piece and the wiring between them. What
 * only a browser can answer is whether the thing a person does — click a chart,
 * pick a table, pick a type, pick two axes — ends with vega actually drawing
 * marks, and whether the document still says so after a reload.
 *
 * The RELOAD step is the point. A single edit followed by a look at the screen
 * passes even when the editor's `source` and the stored row have quietly
 * diverged; only re-reading the document from the server catches that, and only
 * a SECOND edit catches a divergence that starts after the first write.
 *
 * The last leg needs a session, so the dev server must point its mail at this
 * gate's sink:
 *
 *   EMAIL__RESEND_API_KEY=x EMAIL__RESEND_BASE_URL=http://127.0.0.1:4603 npm run dev
 *
 *   usage: node scripts/gate-viz-editor.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
// Printed AS IT HAPPENS, not collected and dumped at the end: this gate has a
// long signed-in leg, and a silent run gives no way to tell a hang from slow
// progress — which cost two full timeout runs before anyone could see that it
// was stuck rather than crawling.
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

const api = async (path, init = {}, token) => {
  const res = await fetch(`${B}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  return res.json();
};

// ── seed: two datasets and a story whose Question renders as a table ────────
// The token rides the start LINK now, not the response body (lib/agent-session).
const start = await startDocument(B);
const token = start.token;
const sales = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({
  title: 'Regional sales', dataset: 'region,revenue\nNorth,4200\nSouth,3100\nEast,5100\nWest,2400',
}) }, token);
const costs = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({
  title: 'Monthly costs', dataset: 'month,spend\n2026-01,900\n2026-02,1400\n2026-03,1100',
}) }, token);

// The document DECLARES both tables; the picker offers exactly these two.
const HELMET = `<Helmet>` +
  `<Query name="sales">{\`select * from ref_${sales.id}\`}</Query>` +
  `<Query name="costs">{\`select * from ref_${costs.id}\`}</Query></Helmet>`;
const story = HELMET + `<div data-design="tw" className="@container p-8">` +
  `<h1 className="text-3xl font-bold">Quarterly review</h1>` +
  `<p className="mt-2 text-base">A paragraph that must survive every chart edit.</p>` +
  `<Question title="Revenue" data="$sales" height="430px" /></div>`;
await api(`/api/artifacts/${start.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Review', markup: story, theme: 'manuscript' }) }, token);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const frame = () => p.frames().find((x) => /\/raw/.test(x.url()));
const frameText = async () => { const f = frame(); return f ? await f.locator('body').innerText().catch(() => '') : ''; };
const marks = async () => { const f = frame(); return f ? await f.locator('svg.marks, canvas').count().catch(() => 0) : 0; };

const openEditor = async () => {
  // Edit mode lives in the owner's shell; ownership is the httpOnly session
  // cookie now, not a localStorage token.
  await becomeOwner(p, B, token);
  await p.goto(`${B}/a/${start.id}#edit`, { waitUntil: 'load' });
  // The document IS the frame the reader was already looking at — editing is a
  // mode it enters, not a canvas built beside it.
  await p.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 40000 });
  await p.waitForFunction(() => !!document.querySelector('iframe[title="artifact"]'), { timeout: 40000 });
  /*
   * Wait for edit mode to be LIVE, not merely for the document to have
   * rendered. The runtime loads its edit chunk on demand, so there is a window
   * where the document is fully drawn and nothing in it is listening — a click
   * there selects nothing and the panel never opens.
   */
  for (let i = 0; i < 120; i++) {
    const ready = await frame()?.evaluate(() => !!document.querySelector('[contenteditable="true"]')).catch(() => false);
    if (ready) break;
    await p.waitForTimeout(150);
  }
};

const clickChart = async () => {
  const f = frame();
  await f.locator('[aria-label="Question embed"]').first().click();
  await p.waitForSelector('[aria-label="Chart editor"]', { timeout: 20000 });
};

// The panel's dropdowns are the house SelectMenu (a button + role=option list),
// not native selects: open the labelled trigger, click the option by its text.
const pickIn = async (pg, label, option) => {
  await pg.click(`[aria-label="${label}"]`);
  await pg.click(`[role="option"]:has-text("${option}")`);
  await pg.waitForTimeout(400); // the edit queue batches
};
const pick = (label, option) => pickIn(p, label, option);
const triggerText = async (pg, label) => (await pg.locator(`[aria-label="${label}"]`).textContent()) ?? '';
const optionsOf = async (pg, label) => {
  await pg.click(`[aria-label="${label}"]`);
  const texts = await pg.locator('[role="option"]').allTextContents();
  await pg.keyboard.press('Escape');
  return texts;
};

// ── the journey ─────────────────────────────────────────────────────────────
await openEditor();
ok((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'the inspector stays shut until a chart is clicked');

await clickChart();
ok(await p.locator('[aria-label="Chart editor"]').isVisible(), 'clicking a chart opens the inspector');
ok((await triggerText(p, 'Table')).includes('$sales'), 'it opens on the table the document names');
ok((await triggerText(p, 'Chart type')).includes('table'), 'and reports a viz-less Question as a table');
// The shelf is the DOCUMENT's own declarations — nothing fetched, nothing to wait for.
const options = await optionsOf(p, 'Table');
ok(options.some((o) => o.includes('$sales')) && options.some((o) => o.includes('$costs')),
  'the picker offers exactly the tables the document declares');
ok((await p.locator('[aria-label="Missing table notice"]').count()) === 0,
  'and does not call a declared binding "missing"');

await pick('Chart type', 'bar');
await pick('X-Axis', 'region');
await pick('Y-Axis', 'revenue');
await p.waitForTimeout(2500);
ok((await marks()) > 0, `vega draws the chart that was just built (${await marks()} marks)`);
ok(!/data unavailable/.test(await frameText()), 'and it is not showing the failure state');
await p.screenshot({ path: '/tmp/viz-editor-built.png' });

// ── it persisted, and the rest of the document is intact ────────────────────
await p.waitForTimeout(1200); // let the queue drain
let stored = await api(`/api/artifacts/${start.id}`, {}, token);
ok(/"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(stored.markup), 'the bar mark is in the STORED document');
ok(stored.markup.includes('"field":"region"') && stored.markup.includes('"field":"revenue"'), 'with both encodings');
ok(stored.markup.includes('A paragraph that must survive'), 'and the prose around it is untouched');
ok(stored.markup.includes('<h1 className="text-3xl font-bold">Quarterly review</h1>'), 'as is the heading');

// ── a SECOND edit, after a reload — where a canonical-form drift would show ──
await openEditor();
// Poll rather than sleep: a fixed wait tuned on localhost fails against a
// deployed server purely for latency, which reads as a broken chart and is not.
for (let i = 0; i < 40 && !(await marks()); i++) await p.waitForTimeout(500);
ok((await marks()) > 0, 'the chart is still there after a reload');
await clickChart();
ok((await triggerText(p, 'Chart type')).includes('bar'), 'the inspector reads the chart back from the document');

await pick('Chart type', 'line');
await pick('Table', '$costs');
await pick('X-Axis', 'month');
await pick('Y-Axis', 'spend');
await p.waitForTimeout(2500);
ok((await marks()) > 0, 'the rebound chart renders — the seeded dataflow already held the other table');
ok(!/data unavailable/.test(await frameText()), 'and never settles on "data unavailable"');

await p.waitForTimeout(1200);
stored = await api(`/api/artifacts/${start.id}`, {}, token);
ok(stored.markup.includes('data="$costs"'), 'the second edit repointed the stored document');
ok(/"mark"\s*:\s*("line"|\{[^}]*"type"\s*:\s*"line")/.test(stored.markup), 'and changed the stored mark');
ok(!stored.markup.includes('data="$sales"'), 'with no trace of the old binding left behind');
ok(stored.markup.includes('A paragraph that must survive'), 'and the document survived TWO edits intact');
ok(stored.version >= 3, `each edit was its own version (v${stored.version})`);

// ── back to a table, which is a real state and not a broken chart ───────────
await pick('Chart type', 'table');
await p.waitForTimeout(2000);
stored = await api(`/api/artifacts/${start.id}`, {}, token);
ok(!/viz=/.test(stored.markup), 'choosing "table" REMOVES the viz prop rather than storing an empty chart');
ok(stored.markup.includes('data="$costs"'), 'while keeping the data binding');
const tableText = await frameText();
ok(/month|spend/i.test(tableText), 'and the page falls back to the data table');
await p.screenshot({ path: '/tmp/viz-editor-table.png' });

// ── the inspector is not offered where it must not write ────────────────────
await p.locator('[aria-label="Close chart inspector"]').click();
ok((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'close shuts it');
{
  const f = frame();
  await f.locator('h1').first().click();
  await p.waitForTimeout(300);
  ok((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'clicking prose leaves the chart inspector shut');
}

// ── "loading" belongs to ONE chart, not the document ────────────────────────
// Two charts; the second one's dataset fetch is made to FAIL, which is how a ref
// actually becomes unresolvable in practice (delete-protection refuses to orphan
// one: DELETE on a referenced dataset is a 409 has_dependents). While the first
// chart is rebound, a chart whose QUERY failed must keep saying so — a
// document-wide pending flag made it claim to be loading instead, forever,
// which is a worse lie than the failure it replaced.
{
  const twoCharts = `<Helmet>` +
    `<Query name="live">{\`select * from ref_${sales.id}\`}</Query>` +
    `<Query name="broken">{\`select nope from ref_${costs.id}\`}</Query></Helmet>` +
    `<div data-design="tw" className="@container p-8">` +
    `<h1 className="text-3xl font-bold">Two charts</h1>` +
    `<Question title="Live" data="$live" height="300px" />` +
    `<Question title="Broken" data="$broken" height="300px" /></div>`;
  // The dry run refuses a bad column at publish, so land it through PUT of a
  // good document first and then break the query by a direct DB-free path:
  // publish the good shape, then use the same document with the column
  // renamed under it — a dataset REFRESH (PUT on the dataset) drops "nope"
  // for real: the document was valid when written and its query fails now.
  const good = twoCharts.replace('select nope from', 'select spend as nope from');
  const st = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Two', markup: good, theme: 'manuscript' }) }, token);
  ok(!!st.id, 'the two-chart story published');
  const refreshed = await api(`/api/artifacts/${costs.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Monthly costs', dataset: 'month,cost\n2026-01,900' }) }, token);
  ok(Array.isArray(refreshed.warnings) && JSON.stringify(refreshed.warnings).includes(st.id), 'the dataset refresh WARNED that the story broke');

  const p2 = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await becomeOwner(p2, B, token); // a fresh page owns nothing until it holds the cookie
  await p2.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!document.querySelector('iframe[title="artifact"]'), { timeout: 40000 });
  const frame2 = () => p2.frames().find((x) => /\/raw/.test(x.url()));
  for (let i = 0; i < 80 && !(await frame2()?.locator('[data-mx-ast]').count().catch(() => 0)); i++) await p2.waitForTimeout(150);
  /*
   * The document renders its BODY, so what it stamps is body-relative: the div
   * is 0 and the broken chart its third child. (In the SOURCE the Helmet is
   * node 0 and the div is 1 — this address was written when the canvas
   * rendered the whole tree, Helmet included, and pointed at nothing here.)
   */
  const brokenText = async () => {
    const fr = frame2();
    return fr ? await fr.locator('[data-mx-ast="0.2"]').innerText().catch(() => '') : '';
  };
  for (let i = 0; i < 25; i++) await p2.waitForTimeout(200);
  ok(/failed/i.test(await brokenText()), 'a chart whose query fails says so, not a permanent "loading"');

  await frame2().locator('[aria-label="Question embed"]').first().click();
  await p2.waitForSelector('[aria-label="Chart editor"]', { timeout: 20000 });
  let brokenSaidLoading = false;
  await pickIn(p2, 'Chart type', 'bar');
  for (let i = 0; i < 20; i++) {
    await p2.waitForTimeout(150);
    if (/loading/i.test(await brokenText())) brokenSaidLoading = true;
  }
  ok(!brokenSaidLoading, 'and never starts claiming to load because ANOTHER chart is busy');
  await p2.close();
}

// ── an agent writes while a chart is selected ───────────────────────────────
// AST paths are positional. An agent inserting a node before the selected chart
// shifts it, and the inspector would then be editing whatever now sits at that
// path — plausibly another chart, which no tag guard downstream would question.
{
  await openEditor();
  await p.waitForTimeout(1500);
  await clickChart();
  const before = await api(`/api/artifacts/${start.id}`, {}, token);
  // Inserted DIRECTLY BEFORE the selected chart, so the held path now names
  // another <Question>. Insert anything else and the panel closes for the wrong
  // reason — the path stops resolving to a Question at all — and the check
  // passes even with the guard deleted. This is the shape with teeth.
  const shifted = before.markup.replace('<Question', '<Question title="Agent chart" data="$sales" height="300px" /><Question');
  const applied = await api(`/api/artifacts/${start.id}/edits`, {
    method: 'POST', body: JSON.stringify({ edit_id: before.edit_id, source: shifted }),
  }, token);
  ok(!!applied.edit_id && applied.edit_id !== before.edit_id, 'the agent edit landed while the inspector was open');
  // The live stream delivers it; the editor adopts because it is idle.
  await p.waitForTimeout(4000);
  ok((await p.locator('[aria-label="Chart editor"]').count()) === 0,
    'the inspector closed rather than silently re-targeting the shifted path');
  const after = await api(`/api/artifacts/${start.id}`, {}, token);
  ok(after.markup.includes('Agent chart'), 'and the agent\'s work is intact');
}

// ── the SIGNED-IN path: a different list endpoint entirely ──────────────────
// A token owner reads /api/artifacts; a signed-in owner reads
// /api/my/artifacts, because a user may hold several claimed tokens and the
// picker has to offer the whole shelf. Same panel, so the same journey must
// work with no stored token anywhere.
try {
  const sink = await startMailSink(4603);
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const email = `mxmx_test_viz_${Date.now().toString(36)}@example.com`;
  await loginViaEmail(page, B, sink, email);
  await page.goto(`${B}/account`, { waitUntil: 'load' });
  await page.fill('[aria-label="Token to claim"]', token);
  await page.click('[aria-label="Claim token"]');
  await page.waitForTimeout(3000);

  // No stored bearer: the editor must authenticate by session alone.
  await page.goto(`${B}/a/${start.id}`, { waitUntil: 'load' });
  await page.goto(`${B}/a/${start.id}#edit`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('iframe[title="artifact"]'), { timeout: 40000 });
  await page.waitForTimeout(3000);
  const sf = page.frames().find((x) => /\/raw/.test(x.url()));
  await sf.locator('[aria-label="Question embed"]').first().click();
  await page.waitForSelector('[aria-label="Chart editor"]', { timeout: 20000 });
  const sessionOptions = await optionsOf(page, 'Table');
  ok(sessionOptions.some((o) => o.includes('$sales')) && sessionOptions.some((o) => o.includes('$costs')),
    'a signed-in owner gets the same picker — the document declares it, no list to fetch');
  await pickIn(page, 'Chart type', 'bar');
  await page.waitForTimeout(600);
  // Read the columns the panel actually offers instead of naming them: earlier
  // legs rewrite this document (the agent-edit leg inserts a chart bound to a
  // different dataset), so whichever Question comes first is not fixed.
  const pickCol = async (label) => {
    const values = (await optionsOf(page, label)).map((t) => t.trim()).filter((t) => t && !/^—/.test(t));
    if (values.length) await pickIn(page, label, values[0].split(/\s/)[0]);
    return values[0] ?? null;
  };
  const xCol = await pickCol('X-Axis');
  await page.waitForTimeout(600);
  const yCol = await pickCol('Y-Axis');
  await page.waitForTimeout(2500);
  ok(!!xCol && !!yCol, `the session-mode panel offered real columns (${xCol}, ${yCol})`);
  const sm = sf ? await sf.locator('svg.marks, canvas').count().catch(() => 0) : 0;
  ok(sm > 0, 'and can build a chart with no stored token at all');
  const after = await api(`/api/artifacts/${start.id}`, {}, token);
  ok(/"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(after.markup), 'which persists through the session-authed edit route');
  sink.close();
} catch (err) {
  // Reported, never swallowed: a leg that could not run is not a leg that passed.
  ok(false, `the signed-in leg could not run — start the dev server with `
    + `EMAIL__RESEND_BASE_URL=http://127.0.0.1:4603 (${String(err).split('\n').slice(0,4).join(' | ')})`);
}

// ── a chart INSIDE A GRID selects on the FIRST click ────────────────────────
/*
 * The dashboard case, which the legs above cannot see: edit mode wraps a
 * <Grid> in react-grid-layout, and RGL inserts its drag placeholder on plain
 * MOUSEDOWN — before any movement — at the pressed tile's own cell, painted
 * over the tile (z-index 2). The mouseup then landed on the placeholder, the
 * targets differed, and the browser retargeted the click to the grid
 * container: selecting a chart took a drag-and-shake. The placeholder is
 * "display only" in RGL's own words and is now pointer-events: none, so ONE
 * plain click must open the inspector. Only a real browser can check this —
 * jsdom has no hit-testing, so the retarget cannot happen there at all.
 */
{
  const gridDoc = `<Helmet><Query name="gsales">{\`select * from ref_${sales.id}\`}</Query></Helmet>`
    + `<div data-design="tw" className="@container p-4">`
    + `<Grid cols={12} rowHeight={86}>`
    + `<GridItem x={0} y={0} w={6} h={4}><Question title="Grid chart" data="$gsales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} /></GridItem>`
    + `<GridItem x={6} y={0} w={6} h={4}><Question title="Grid table" data="$gsales" /></GridItem>`
    + `</Grid></div>`;
  const gd = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Grid dash', markup: gridDoc, theme: 'manuscript' }) }, token);
  ok(!!gd.id, 'the grid dashboard published');
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await becomeOwner(pg, B, token);
  await pg.goto(`${B}/a/${gd.id}#edit`, { waitUntil: 'load' });
  await pg.waitForFunction(() => !!document.querySelector('iframe[title="artifact"]'), { timeout: 40000 });
  const gf = () => pg.frames().find((x) => /\/raw/.test(x.url()));
  // Edit is LIVE when RGL's drag layer exists — that layer is the thing under test.
  for (let i = 0; i < 120 && !(await gf()?.locator('.react-grid-item').count().catch(() => 0)); i++) await pg.waitForTimeout(150);
  ok((await gf().locator('.react-grid-item').count()) > 0, 'edit mode wrapped the grid in the drag layer — otherwise this proves nothing');
  for (let i = 0; i < 40 && !(await gf().locator('svg.marks, canvas').count().catch(() => 0)); i++) await pg.waitForTimeout(250);
  // ONE plain click, dead center on the chart — no drag, no shake.
  await gf().locator('[aria-label="Question embed"]').first().click();
  const opened = await pg.waitForSelector('[aria-label="Chart editor"]', { timeout: 8000 }).then(() => true).catch(() => false);
  ok(opened, 'ONE click on a chart inside a grid opens the inspector');
  await pg.close();
}

await b.close();
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
