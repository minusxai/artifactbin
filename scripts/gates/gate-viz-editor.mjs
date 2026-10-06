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
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *
 * The document is framed by the app page on its own origin: the charts, the prose and the edit surface are
 * the frame's; the chart inspector, the toolbar and its save status are the page's.
 *
 *   usage: node scripts/gates/gate-viz-editor.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentLocator } from './lib/page-facts.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { mergeGuestIntoAccount, becomeOwner, startDocument } from '../lib/start-doc.mjs';
import { parse as parseYaml } from 'yaml';

const B = process.argv[2] ?? 'http://localhost:3030';
// Printed AS IT HAPPENS, not collected and dumped at the end: this gate has a
// long signed-in leg, and a silent run gives no way to tell a hang from slow
// progress — which cost two full timeout runs before anyone could see that it
// was stuck rather than crawling.
const check = createChecker('viz-editor');

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
  `<Import name="sales_data" src="ref:${sales.id}" /><Query name="sales">{\`select * from sales_data.rows\`}</Query>` +
  `<Import name="costs_data" src="ref:${costs.id}" /><Query name="costs">{\`select * from costs_data.rows\`}</Query></Helmet>`;
const story = HELMET + `<div data-design="tw" className="@container p-8">` +
  `<h1 id="heading" className="text-3xl font-bold">Quarterly review</h1>` +
  `<p className="mt-2 text-base">A paragraph that must survive every chart edit.</p>` +
  `<Question title="Revenue" data="$sales" height="430px" /></div>`;
await api(`/api/artifacts/${start.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Review', markup: story, theme: 'manuscript', template: 'doc' }) }, token);

// The gate app uses a loopback HTTP alias; emulate production HTTPS for its clipboard API.
const b = await launchChromium({ args: [`--unsafely-treat-insecure-origin-as-secure=${B}`] });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
const frame = () => documentLocator(p);
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
  await frame().locator('[data-mx-inline-story]').waitFor({ state: 'attached', timeout: 40000 });
  /*
   * Wait for edit mode to be LIVE, not merely for the document to have
   * rendered. The runtime loads its edit chunk on demand, so there is a window
   * where the document is fully drawn and nothing in it is listening — a click
   * there selects nothing and the panel never opens.
   */
  for (let i = 0; i < 120; i++) {
    const ready = (await frame().locator('[contenteditable="true"]').count().catch(() => 0)) > 0;
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
/*
 * A table switch re-derives the axis pickers from the NEW table's columns. Pick
 * an axis only once its picker offers that table's column — picking against the
 * previous table's options (or a still-disabled picker) is a gate race, not a
 * product result.
 */
const waitForOption = async (pg, label, option) => {
  for (let i = 0; i < 60; i++) {
    const trigger = pg.locator(`[aria-label="${label}"]`);
    if (await trigger.isEnabled().catch(() => false)
      && (await optionsOf(pg, label)).some((o) => o.trim().split(/\s/)[0] === option)) return true;
    await pg.waitForTimeout(250);
  }
  return false;
};
/** The toolbar's save status: "not saved — …", "Saving…", or "vN · Saved". */
const saveStatus = async (pg) => (await pg.locator('[aria-label="Document actions"] [role="status"]').textContent().catch(() => '')) ?? '';

// ── a chart INSIDE A GRID selects on the FIRST click ────────────────────────
// Its own document and page, so it runs BESIDE the main journey rather than after it.
/*
 * The dashboard case, which the legs above cannot see: edit mode wraps a
 * A chart inside a grid must open the inspector on one plain click. The
 * Solid editor mounts a separate grip over each tile, so the chart itself
 * must remain clickable. Only a real browser can check hit testing here.
 */
const gridLeg = (async () => {
  const gridDoc = `<Helmet><Import name="gsales_data" src="ref:${sales.id}" /><Query name="gsales">{\`select * from gsales_data.rows\`}</Query></Helmet>`
    + `<div data-design="tw" className="@container p-4">`
    + `<Grid cols={12} rowHeight={86}>`
    + `<GridItem x={0} y={0} w={6} h={4}><Question title="Grid chart" data="$gsales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} /></GridItem>`
    + `<GridItem x={6} y={0} w={6} h={4}><Question title="Grid table" data="$gsales" /></GridItem>`
    + `</Grid></div>`;
  const gd = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Grid dash', markup: gridDoc, theme: 'manuscript' }) }, token);
  check(!!gd.id, 'the grid dashboard published');
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await becomeOwner(pg, B, token);
  await pg.goto(`${B}/a/${gd.id}#edit`, { waitUntil: 'load' });
  const gf = () => documentLocator(pg);
  await gf().locator('[data-mx-inline-story]').waitFor({ state: 'attached', timeout: 40000 });
  // Edit is live when the Solid grid grips are mounted.
  for (let i = 0; i < 120 && !(await gf()?.locator('.mx-grid-grip').count().catch(() => 0)); i++) await pg.waitForTimeout(150);
  check((await gf().locator('.mx-grid-grip').count()) > 0, 'edit mode mounted grid controls');
  for (let i = 0; i < 40 && !(await gf().locator('svg.marks, canvas').count().catch(() => 0)); i++) await pg.waitForTimeout(250);
  // ONE plain click, dead center on the chart — no drag, no shake.
  await gf().locator('[aria-label="Question embed"]').first().click();
  const opened = await pg.waitForSelector('[aria-label="Chart editor"]', { timeout: 8000 }).then(() => true).catch(() => false);
  check(opened, 'ONE click on a chart inside a grid opens the inspector');
  await pg.close();
})().catch((err) => check(false, `the grid leg could not run (${String(err).split('\n').slice(0, 4).join(' | ')})`));

// The signed-in leg's login runs beside the journey too; only adopting the guest token waits for the end, so the
// journey's token-owned edits are made exactly as before.
const sink = await startMailSink();
const sessionPage = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const sessionEmail = `mxmx_test_viz_${Date.now().toString(36)}@example.com`;
const signedIn = loginViaEmail(sessionPage, B, sink, sessionEmail).then(() => null, (err) => err);

// ── the journey ─────────────────────────────────────────────────────────────
await openEditor();
check((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'the inspector stays shut until a chart is clicked');
/*
 * THE DOCUMENT DOES NOT MOVE inside an edit session. The inspector fills the
 * edit panel, which has been there since entry: select,
 * close and select-something-else all leave the text column exactly where it
 * was — it used to jump sideways under the pointer on every one of them.
 */
// Measured ON SCREEN (the frame's offset plus the paragraph's place in it), so a frame that moves counts too.
const column = async () => {
  const r = await frame().locator('[data-mx-inline-story] p').first().boundingBox({ timeout: 5000 }).catch(() => null);
  return r ? `${Math.round(r.x)}/${Math.round(r.width)}` : 'missing';
};
const entered = await column();
check(entered !== 'missing', `the document column is measurable in edit mode (${entered})`);

await clickChart();
check(await p.locator('[aria-label="Chart editor"]').isVisible(), 'clicking a chart opens the inspector');
check(await column() === entered, `selecting a chart moves no document (${entered} → ${await column()})`);
check((await triggerText(p, 'Table')).includes('$sales'), 'it opens on the table the document names');
check((await triggerText(p, 'Chart type')).includes('table'), 'and reports a viz-less Question as a table');
// The shelf is the DOCUMENT's own declarations — nothing fetched, nothing to wait for.
const options = await optionsOf(p, 'Table');
check(options.some((o) => o.includes('$sales')) && options.some((o) => o.includes('$costs')),
  'the picker offers exactly the tables the document declares');
check((await p.locator('[aria-label="Missing table notice"]').count()) === 0,
  'and does not call a declared binding "missing"');

await pick('Chart type', 'bar');
await pick('X-Axis', 'region');
await pick('Y-Axis', 'revenue');
await p.waitForTimeout(2500);
check((await marks()) > 0, `vega draws the chart that was just built (${await marks()} marks)`);
check(!/data unavailable/.test(await frameText()), 'and it is not showing the failure state');
await p.screenshot({ path: '/tmp/viz-editor-built.png' });

// ── it persisted, and the rest of the document is intact ────────────────────
await p.waitForTimeout(1200); // let the queue drain
let stored = await api(`/api/artifacts/${start.id}`, {}, token);
check(/"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(stored.markup), 'the bar mark is in the STORED document');
check(stored.markup.includes('"field":"region"') && stored.markup.includes('"field":"revenue"'), 'with both encodings');
check(stored.markup.includes('A paragraph that must survive'), 'and the prose around it is untouched');
check(stored.markup.includes('<h1 id="heading" className="text-3xl font-bold">Quarterly review</h1>'), 'as is the heading');

// ── a SECOND edit, after a reload — where a canonical-form drift would show ──
await openEditor();
// Poll rather than sleep: a fixed wait tuned on localhost fails against a
// deployed server purely for latency, which reads as a broken chart and is not.
for (let i = 0; i < 40 && !(await marks()); i++) await p.waitForTimeout(500);
check((await marks()) > 0, 'the chart is still there after a reload');
await clickChart();
check((await triggerText(p, 'Chart type')).includes('bar'), 'the inspector reads the chart back from the document');

await pick('Chart type', 'line');
await pick('Table', '$costs');
check(await waitForOption(p, 'X-Axis', 'month'), 'the axis pickers offer the new table\'s columns after the switch');
await pick('X-Axis', 'month');
await pick('Y-Axis', 'spend');
await p.waitForTimeout(2500);
check((await marks()) > 0, 'the rebound chart renders — the seeded dataflow already held the other table');
check(!/data unavailable/.test(await frameText()), 'and never settles on "data unavailable"');

await p.waitForTimeout(1200);
stored = await api(`/api/artifacts/${start.id}`, {}, token);
check(stored.markup.includes('data="$costs"'), 'the second edit repointed the stored document');
check(/"mark"\s*:\s*("line"|\{[^}]*"type"\s*:\s*"line")/.test(stored.markup), 'and changed the stored mark');
check(!stored.markup.includes('data="$sales"'), 'with no trace of the old binding left behind');
check(stored.markup.includes('A paragraph that must survive'), 'and the document survived TWO edits intact');
check(stored.version >= 3, `each edit was its own version (v${stored.version})`);

// ── back to a table, which is a real state and not a broken chart ───────────
await pick('Chart type', 'table');
await p.waitForTimeout(2000);
stored = await api(`/api/artifacts/${start.id}`, {}, token);
check(!/viz=/.test(stored.markup), 'choosing "table" REMOVES the viz prop rather than storing an empty chart');
check(stored.markup.includes('data="$costs"'), 'while keeping the data binding');
const tableText = await frameText();
check(/month|spend/i.test(tableText), 'and the page falls back to the data table');
await p.screenshot({ path: '/tmp/viz-editor-table.png' });

// ── the SLOW human path: switch table, pause, then fix the axes ──────────────
// A person switches the table and only then looks for the axes. Between those
// picks the chart still encodes the old table's columns, so that write is
// REFUSED on its own — honestly. The axis picks that make it valid again must
// then land: a refused intermediate may not wedge the queue on "not saved".
{
  const storedChart = async () => {
    const doc = await api(`/api/artifacts/${start.id}`, {}, token);
    return doc.markup ?? '';
  };
  const until = async (test, tries = 40) => {
    for (let i = 0; i < tries; i++) { if (await test()) return true; await p.waitForTimeout(250); }
    return false;
  };
  await pick('Chart type', 'bar');
  check(await waitForOption(p, 'X-Axis', 'month'), 'a fresh bar chart on $costs offers its columns');
  await pick('X-Axis', 'month');
  await pick('Y-Axis', 'spend');
  const barOnCosts = (m) => m.includes('data="$costs"') && m.includes('"field":"month"') && m.includes('"field":"spend"')
    && /"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(m);
  check(await until(async () => barOnCosts(await storedChart())), 'the slow leg starts from a stored bar chart on $costs');

  await pick('Table', '$sales');
  const refused = await until(async () => /not saved/.test(await saveStatus(p)));
  check(refused, `the table switch alone is refused while the axes still name $costs columns (${await saveStatus(p)})`);
  // Recovery must copy the current JSX and metadata even while this intermediate update is refused.
  // The title and color-mode edits below are deliberately unsaved at the time of copying.
  await p.locator('[aria-label="Title"]').fill('Unsaved recovery title');
  await p.click('[aria-label="Color mode"]');
  await p.click('[aria-label="Color mode dark"]');
  await p.getByRole('button', { name: 'Copy draft' }).click();
  const copiedDraft = await p.evaluate(async () => navigator.clipboard.readText());
  const copiedParts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(copiedDraft);
  check(!!copiedParts, 'Copy draft is portable YAML-frontmatter JSX');
  if (copiedParts) {
    const copiedMetadata = parseYaml(copiedParts[1]);
    check(copiedMetadata.title === 'Unsaved recovery title' && copiedMetadata.theme === 'manuscript'
      && copiedMetadata.template === 'doc' && copiedMetadata.colorMode === 'dark', 'the copy contains current title, theme, template and color mode');
    check(copiedParts[2].includes('A paragraph that must survive every chart edit.'), 'the exact current JSX body marker is preserved');
    check(Object.keys(copiedMetadata).sort().join(',') === 'colorMode,template,theme,title', 'the recovery copy carries no remote identity or sharing grants');
  }
  await p.waitForTimeout(1500); // the human pause: well past the batch window
  check(await waitForOption(p, 'X-Axis', 'region'), 'after the pause the axis pickers offer $sales columns');
  await pick('X-Axis', 'region');
  await p.waitForTimeout(1500); // and another between the two axes
  await pick('Y-Axis', 'revenue');
  const barOnSales = (m) => m.includes('data="$sales"') && m.includes('"field":"region"') && m.includes('"field":"revenue"')
    && !m.includes('"field":"month"') && /"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(m);
  check(await until(async () => barOnSales(await storedChart())), 'the axis picks after the refusal SAVED: the stored chart is bar on $sales, region × revenue');
  check(await until(async () => !/not saved/.test(await saveStatus(p))), `and the "not saved" status cleared (${await saveStatus(p)})`);
  check((await storedChart()).includes('A paragraph that must survive'), 'with the prose still intact');

  // The same rebind on a SLOW NETWORK (/prepare held 2.5 s) is dropped: it repeated the refused-switch-then-axes leg
  // above (a refusal, then picks that must still save and clear "not saved"), at ~10 s of fixed waits.
}

// ── the inspector is not offered where it must not write ────────────────────
await p.locator('[aria-label="Close chart inspector"]').click();
check((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'close shuts it');
{
  const f = frame();
  await f.locator('h1').first().click();
  await p.waitForTimeout(300);
  check((await p.locator('[aria-label="Chart editor"]').count()) === 0, 'clicking prose leaves the chart inspector shut');
  check(await column() === entered, `closing the inspector and selecting prose move no document (${entered} → ${await column()})`);
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
    `<Import name="live_data" src="ref:${sales.id}" /><Query name="live">{\`select * from live_data.rows\`}</Query>` +
    `<Import name="broken_data" src="ref:${costs.id}" /><Query name="broken">{\`select nope from broken_data.rows\`}</Query></Helmet>` +
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
  check(!!st.id, 'the two-chart story published');
  const refreshed = await api(`/api/artifacts/${costs.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Monthly costs', dataset: 'month,cost\n2026-01,900' }) }, token);
  check(Array.isArray(refreshed.warnings) && JSON.stringify(refreshed.warnings).includes(st.id), 'the dataset refresh WARNED that the story broke');

  const p2 = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await becomeOwner(p2, B, token); // a fresh page owns nothing until it holds the cookie
  await p2.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'load' });
  const frame2 = () => documentLocator(p2);
  await frame2().locator('[data-mx-inline-story]').waitFor({ state: 'attached', timeout: 40000 });
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
  check(/failed/i.test(await brokenText()), 'a chart whose query fails says so, not a permanent "loading"');

  await frame2().locator('[aria-label="Question embed"]').first().click();
  await p2.waitForSelector('[aria-label="Chart editor"]', { timeout: 20000 });
  let brokenSaidLoading = false;
  await pickIn(p2, 'Chart type', 'bar');
  for (let i = 0; i < 20; i++) {
    await p2.waitForTimeout(150);
    if (/loading/i.test(await brokenText())) brokenSaidLoading = true;
  }
  check(!brokenSaidLoading, 'and never starts claiming to load because ANOTHER chart is busy');
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
  check(!!applied.edit_id && applied.edit_id !== before.edit_id, 'the agent edit landed while the inspector was open');
  // The live stream delivers it; the editor adopts because it is idle.
  await p.waitForTimeout(4000);
  check((await p.locator('[aria-label="Chart editor"]').count()) === 0,
    'the inspector closed rather than silently re-targeting the shifted path');
  const after = await api(`/api/artifacts/${start.id}`, {}, token);
  check(after.markup.includes('Agent chart'), 'and the agent\'s work is intact');
}

// ── the SIGNED-IN path: a different list endpoint entirely ──────────────────
// A token owner reads /api/artifacts; a signed-in owner reads
// /api/my/artifacts, because a user may hold several claimed tokens and the
// picker has to offer the whole shelf. Same panel, so the same journey must
// work with no stored token anywhere.
try {
  const page = sessionPage;
  const loginError = await signedIn;
  if (loginError) throw loginError;
  await mergeGuestIntoAccount(page, B, token);
  await page.waitForTimeout(1000);

  // No stored bearer: the editor must authenticate by session alone.
  await page.goto(`${B}/a/${start.id}`, { waitUntil: 'load' });
  await page.goto(`${B}/a/${start.id}#edit`, { waitUntil: 'load' });
  const sf = documentLocator(page);
  await sf.locator('[data-mx-inline-story]').waitFor({ state: 'attached', timeout: 40000 });
  await page.waitForTimeout(3000);
  await sf.locator('[aria-label="Question embed"]').first().click();
  await page.waitForSelector('[aria-label="Chart editor"]', { timeout: 20000 });
  const sessionOptions = await optionsOf(page, 'Table');
  check(sessionOptions.some((o) => o.includes('$sales')) && sessionOptions.some((o) => o.includes('$costs')),
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
  check(!!xCol && !!yCol, `the session-mode panel offered real columns (${xCol}, ${yCol})`);
  const sm = sf ? await sf.locator('svg.marks, canvas').count().catch(() => 0) : 0;
  check(sm > 0, 'and can build a chart with no stored token at all');
  const after = await api(`/api/artifacts/${start.id}`, {}, token);
  check(/"mark"\s*:\s*("bar"|\{[^}]*"type"\s*:\s*"bar")/.test(after.markup), 'which persists through the session-authed edit route');
  sink.close();
} catch (err) {
  // Reported, never swallowed: a leg that could not run is not a leg that passed.
  check(false, `the signed-in leg could not run — read its OTP with npm run dev:otp -- <email> (${String(err).split('\n').slice(0,4).join(' | ')})`);
}

await gridLeg;

await b.close();
check.done();
