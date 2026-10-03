/**
 * Gate: the DATA journey, as one walk over one fixture set — a dataset becomes numbers on a page, the page
 * re-runs its queries itself, a private reader gets in through the document's door, a link carries the
 * reader's selection, local SQL never becomes a stored write, a policy editor opens and closes a write
 * live, and an external PostgreSQL source never leaks a credential or a hidden value.
 *
 * Absorbs dataflow, local-sql-state, dataset-policies, data-ux and postgres-datasets (proposal §3 row 10).
 * Two connections: one stays a guest (the public documents, the data-ux owner, the policy owner), one is
 * adopted into the owner account (the private documents, the PostgreSQL leg). Two logins: the owner and a
 * second account, which is dataflow's private reader, the policy editor and the PostgreSQL recipient — on
 * different artifacts, so the roles never meet. Independent legs run side by side; the booking click
 * timing runs last, alone.
 *
 * Needs Docker (a disposable postgres:17-alpine on a loopback port), so the manifest says needsPostgres and
 * the gate container refuses it. Every document check reads inside the document's frame (lib/page-facts).
 *
 *   usage: node scripts/gates/gate-data-journey.mjs [base]
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { launchChromium, PAGES_HOST } from './lib/browser.mjs';
import { DOCUMENT_FRAME, documentFrame, documentLocator, inlineStory, INLINE_STORY } from './lib/page-facts.mjs';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { becomeOwner, mergeGuestIntoAccount, startDocument } from '../lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { notificationDocumentPayload, notificationMutationPayload } from '../fixtures/postgres-notifications.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('data-journey');
const execFileP = promisify(execFile);
/** A group of assertions that reports as one check: ok when the body finishes, FAIL naming the first broken assertion. */
const step = async (label, body) => {
  try { await body(); return check(true, label); } catch (error) { return check(false, `${label} — ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`); }
};
/** A lane of the journey: a thrown error is reported as a failure, and the other lanes keep walking. */
const lane = async (name, body) => {
  try { await body(); } catch (error) { check(false, `${name}: the journey stopped — ${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
};
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; } };
const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_data_owner_${stamp}@example.com`;
const SECOND_EMAIL = `mxmx_test_data_second_${stamp}@example.com`;

/** The document's frame once it is live: its islands have hydrated (`<html data-mx-ready>`). */
const liveDocument = async (page) => {
  const doc = await documentFrame(page);
  await doc.locator('html[data-mx-ready] [data-mx-inline-story]').first().waitFor({ timeout: 30_000, state: 'visible' });
  return doc;
};
/** The document's own origin, where its standalone page is served (lib/serving/pages-origin). */
const documentOrigin = (id) => { const app = new URL(B); return `${app.protocol}//${Buffer.from(id, 'utf8').toString('hex')}.${PAGES_HOST}${app.port ? `:${app.port}` : ''}`; };
/** Armed BEFORE a navigation: the framed document's own navigation response (after the pages-session redirect). */
const documentResponse = (page) => page.waitForResponse((r) => { try { return r.frame() !== page.mainFrame() && r.request().isNavigationRequest() && r.status() === 200; } catch { return false; } }, { timeout: 30_000 });
/** Armed BEFORE a navigation: resolves once that page has loaded its SQLite engine's wasm (false after 20 s). */
const engineLoads = (page) => page.waitForResponse((r) => r.url().endsWith('.wasm') && r.ok(), { timeout: 20000 }).then(() => true, () => false);

// ── the disposable PostgreSQL, started now and awaited by its leg ──────────────
const adminPassword = randomUUID();
const readerPassword = randomUUID();
let container;
let admin;
const postgres = (async () => {
  container = (await execFileP('docker', ['run', '--rm', '-d', '-e', `POSTGRES_PASSWORD=${adminPassword}`, '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' })).stdout.trim();
  const port = Number((await execFileP('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' })).stdout.trim().split(':').at(-1));
  for (let attempt = 0; attempt < 100; attempt++) {
    admin = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: adminPassword, connectionTimeoutMillis: 1000 });
    try { await admin.connect(); break; }
    catch { await admin.end(); if (attempt === 99) throw new Error('disposable Postgres did not become ready'); await delay(200); }
  }
  // Password is a generated UUID, never authored SQL or an external credential.
  await admin.query(`CREATE ROLE dataset_reader LOGIN PASSWORD '${readerPassword}';
    CREATE SCHEMA sales; CREATE SCHEMA support;
    CREATE TABLE sales.orders (id integer, region text, amount integer, customer_secret text);
    INSERT INTO sales.orders VALUES (1,'west',120,'hidden-west'),(2,'east',90,'hidden-east'),(3,'west',30,'hidden-west');
    CREATE TABLE sales.internal_notes (secret text);
    CREATE TABLE support.tickets (id integer, subject text);
    INSERT INTO support.tickets VALUES (10,'Refund requested');
    GRANT USAGE ON SCHEMA sales,support TO dataset_reader;
    GRANT SELECT ON sales.orders,support.tickets TO dataset_reader;`);
  return port;
})();
postgres.catch(() => {}); // awaited (and reported) by the PostgreSQL leg

const b = await launchChromium();
const sink = await startMailSink();
try {
// ── two connections: a guest, and one the owner account adopts ─────────────────
const [guestConnection, adoptedConnection] = await Promise.all([connectAgent(B), connectAgent(B)]);
const tok = guestConnection.token;
const ownerTok = adoptedConnection.token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const OH = { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' };
const api = (path, body) => fetch(`${B}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const ownerPost = (path, body) => fetch(`${B}${path}`, { method: 'POST', headers: OH, body: JSON.stringify(body) });

// ── fixtures, published at once ─────────────────────────────────────────────────
/** The page's own script: an effect over the `sales` and `region` signals, rendering into a node the markup does not bind. */
const DATAFLOW_SCRIPT = [
  "import { query, signal } from 'page';",
  "import { createEffect } from 'solid-js';",
  "const sales = query('$sales'); const [region] = signal('$region');",
  "const out = document.getElementById('out');",
  "let initial;",
  "createEffect(() => {",
  "  const now = region(); const rows = sales();",
  "  if (initial === undefined) initial = now;",
  "  out.textContent = now !== initial ? 'changed:' + now : 'page:' + typeof sales + ' rows=' + rows.length;",
  "});",
].join('\n');
const doc1 = (ds_) => `<Helmet><title>Dataflow gate</title><Value name="region" type="string" />
<Import name="regions_data" src="ref:${ds_}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>
<Import name="sales_data" src="ref:${ds_}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
<script>{${JSON.stringify(DATAFLOW_SCRIPT)}}</script></Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Sales</h1>
<select aria-label="Region" value="$region" options="$regions" />
<p id="out">pending</p>
<p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<Question title="Revenue by region" data="$sales" viz={{"kind":"table"}} height="300px" /></div>`;
/** Reactive JSX, document-local SQL and Dialog over both document transports (was gate-local-sql-state). */
const LOCAL_SOURCE = `<Helmet>
  <Value name="count" type="number" default={0} />
  <Value name="open" type="boolean" default={false} />
  <Value name="note" type="string" default="draft" />
  <Value name="choice" type="string" default="a" />
  <Value name="drafts" type="table" value={[{"id":1,"label":"first"}]} />
  <Query name="draft_count">{\`select count(*) n from drafts\`}</Query>
  <Mutation name="add_draft">{\`insert into drafts values ((select coalesce(max(id),0)+1 from drafts), $note)\`}</Mutation>
</Helmet>
<main data-design="tw" className="@container p-8">
  <select aria-label="Choice" value="$choice" options={["a","b"]} />
  <p aria-label="Count">{$count}</p>
  <p aria-label="Rows"><Number data="$draft_count" col="n" /></p>
  {$count > 0 && <p aria-label="Positive">positive</p>}
  {$choice === "b" ? <p aria-label="Branch">bee</p> : <p aria-label="Branch">aye</p>}
  <Button aria-label="Add draft" run="$add_draft">Add draft</Button>
  <Dialog open="$open">
    <DialogTrigger aria-label="Open dialog">Open dialog</DialogTrigger>
    <DialogContent aria-label="Draft dialog" run="$add_draft">
      <input aria-label="Note" value="$note" required autoFocus />
      <Button aria-label="Save dialog" type="submit" set={{"count": 1}}>Save</Button>
      <DialogClose aria-label="Close dialog">Cancel</DialogClose>
    </DialogContent>
  </Dialog>
</main>`;
const rows200 = Array.from({ length: 200 }, (_, i) => ({ id: i, region: ['EU', 'NA', 'APAC'][i % 3], revenue: (i * 7919) % 10007 }));
const bookingDay = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const bookingRows = Array.from({ length: 40 }, (_, i) => {
  const day = bookingDay(i % 20), slot = `${String(9 + (i % 8)).padStart(2, '0')}:00`;
  return { id: `${day}_${slot}`, day, slot, booked_by: 'usr_elsewhere', note: '', created_at: new Date().toISOString() };
});
const CSV = 'month,revenue,zip,note\n2026-01,120,01234,ok\n2026-02,,09876,\n2026-03,190,01234,fine';

const [ds, big, bookings, lsDataset, made, ingested, editData, policyDataset, pgSeed, chartSeed, editSeed] = await Promise.all([
  api('/api/artifacts', { dataset: [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }] }).then(j),
  api('/api/artifacts', { dataset: rows200 }).then(j),
  api('/api/artifacts', { dataset: bookingRows, visibility: 'public' }).then(j),
  // Published by the connection the owner adopts LATER, exactly as local-sql-state did.
  ownerPost('/api/artifacts', { dataset: [{ id: 1, label: 'stored' }], access: 'readwrite' }).then(j),
  api('/api/artifacts', { title: 'Q3 Revenue', dataset: CSV, access: 'read' }).then(j),
  api('/api/artifacts', { title: 'sales', dataset: 'month,revenue,zip\n2026-01,120,01234\n2026-02,150,09876\n2026-03,190,01234' }).then(j),
  api('/api/artifacts', { title: 'edit-mode data', dataset: 'region,revenue\nNorth,4200\nSouth,3100' }).then(j),
  api('/api/artifacts', { dataset: [{ branch: 'root' }], access: 'readwrite' }).then(async (r) => { assert.equal(r.status, 201, await r.clone().text()); return r.json(); }),
  // The PostgreSQL document is a PUT over an existing document of the adopted connection (it was a started one).
  ownerPost('/api/artifacts', { markup: '<p>PostgreSQL document placeholder</p>', visibility: 'unlisted' }).then(j),
  api('/api/artifacts', { markup: '<p>chart placeholder</p>' }).then(j),
  api('/api/artifacts', { markup: '<p>edit placeholder</p>' }).then(j),
]);
check(!!ds.id, 'the dataset published');
const [doc, bad, retired, tdoc, booking, lsDoc, aclDoc, policyDoc] = await Promise.all([
  api('/api/artifacts', { markup: doc1(ds.id) }).then(j),
  api('/api/artifacts', { markup: doc1(ds.id).replace('sum(revenue)', 'sum(revenu)') }).then(async (r) => ({ status: r.status, body: await j(r) })),
  api('/api/artifacts', { markup: `<Question data="ref:${ds.id}" />` }).then(async (r) => ({ status: r.status, body: await j(r) })),
  api('/api/artifacts', { markup: `<Helmet><Import name="all_data" src="ref:${big.id}" /><Query name="all">{\`select a.id * 200 + b.id as id, a.region, (a.revenue + b.revenue) % 10007 as revenue from all_data.rows a cross join all_data.rows b order by 1\`}</Query></Helmet>
<div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Big table</h1>
<DataTable data="$all" height="360px" columns={[{"col":"id","title":"ID"},{"col":"region","title":"Region"},{"col":"revenue","title":"Revenue","fmt":"$,.0f","bar":true}]} /></div>` }).then(j),
  api('/api/artifacts', { markup: readFileSync(new URL('../../services/app/lib/story/__tests__/fixtures/booking.jsx', import.meta.url), 'utf8').replace('ref:BookRows1', `ref:${bookings.id}`), visibility: 'public' }).then(j),
  ownerPost('/api/artifacts', { markup: LOCAL_SOURCE, visibility: 'unlisted' }).then(j),
  ownerPost('/api/artifacts', { markup: `<Helmet><Import name="stored_write_data" src="ref:${lsDataset.id}" /><Mutation name="stored_write">{\`insert into stored_write_data.rows (id, label) values (2, 'forbidden')\`}</Mutation></Helmet><Button run="$stored_write">Write</Button>`, visibility: 'unlisted' }).then(j),
  api('/api/artifacts', { markup: `<Helmet><Value name="branch" default="new branch"/><Import name="tree_data" src="ref:${policyDataset.id}" /><Query name="tree">{\`select * from tree_data.rows\`}</Query><Import name="append_data" src="ref:${policyDataset.id}" /><Mutation name="append">{\`insert into append_data.rows values ($branch)\`}</Mutation><Import name="delete_data" src="ref:${policyDataset.id}" /><Mutation name="delete">{\`delete from delete_data.rows\`}</Mutation></Helmet><h1>Shared policy tree</h1><Button run="$append">Append branch</Button><Button run="$delete">Delete tree</Button><DataTable data="$tree"/>` }).then(async (r) => { assert.equal(r.status, 201, await r.clone().text()); return r.json(); }),
]);
check(!!doc.id, `the dataflow document published (${doc.url ?? doc.error})`);
check(bad.status === 400 && bad.body.error === 'invalid_sql' && /<Query> \\"sales\\" reads revenu — no such column/.test(JSON.stringify(bad.body.details)),
  'a bad column is refused at publish, the compiler naming the query and the column');
check(retired.status === 400 && /<Import name="data" src="ref:[^"]+" \/><Query name="rows">/.test(retired.body.details?.[0]?.message ?? ''), 'data="ref:" is retired and the 400 names the <Import> + <Query> replacement');
check(!!tdoc.id, 'the DataTable document published');
check(!!booking.id, `the booking document published (${booking.url ?? JSON.stringify(booking.details ?? booking.error)})`);
check(!!lsDataset.id && !!lsDoc.id && !!aclDoc.id, `fixtures published (${lsDataset.id}, ${lsDoc.id})`);
if (!lsDataset.id || !lsDoc.id || !aclDoc.id) throw new Error(`fixture publish failed: ${JSON.stringify({ lsDataset, lsDoc, aclDoc })}`);

  // ── two people: the owner (who adopts the second connection) and a second account ──
  const ownerCtx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  const ownerHome = await ownerCtx.newPage();
  const secondCtx = await b.newContext();
  const secondHome = await secondCtx.newPage();
  await Promise.all([loginViaEmail(ownerHome, B, sink, OWNER_EMAIL), loginViaEmail(secondHome, B, sink, SECOND_EMAIL)]);

  // ── LOCAL SQL, anonymous: runs while the owner adopts the connection that published it ──
  /** One reader's walk over the local-state document (was gate-local-sql-state's `exercise`). */
  const exercise = async (page, who, documentId) => {
    const routeBodies = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes(`/a/${documentId}/`)) {
        try { routeBodies.push({ url: request.url(), body: request.postDataJSON() }); } catch {}
      }
    });
    await page.goto(`${B}/a/${documentId}?$choice=b`, { waitUntil: 'load' });
    const frame = await documentFrame(page);
    // The author iframe's `#root` is gone: the story is the framed document's own body.
    const root = '';
    const named = label => `${root}[aria-label="${label}"]`;
    await frame.waitForFunction(root => document.querySelector(`${root}[aria-label="Rows"]`)?.textContent?.trim() === '1', root, { timeout: 20_000 }).catch(async error => {
      throw new Error(`${error.message}; page=${(await frame.locator('body').innerText()).slice(0, 1000)}`);
    });
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-mx-ready'));
    check((await frame.textContent(named('Branch'))) === 'bee', `${who}: URL scalar seeds the ternary`);
    await page.waitForTimeout(500);
    await frame.click(named('Add draft'));
    await frame.waitForFunction(root => document.querySelector(`${root}[aria-label="Rows"]`)?.textContent?.trim() === '2', root);
    await frame.click(named('Add draft'));
    await frame.waitForFunction(root => document.querySelector(`${root}[aria-label="Rows"]`)?.textContent?.trim() === '3', root);
    await frame.waitForFunction(root => !document.querySelector(`${root}[aria-label="Add draft"]`)?.hasAttribute('disabled'), root);
    check(true, `${who}: repeated local table edits feed the dependent query`);
    await frame.click(named('Open dialog'));
    await frame.locator(named('Draft dialog')).waitFor({ state: 'visible', timeout: 15_000 });
    const note = frame.locator(named('Note'));
    await note.waitFor({ state: 'visible', timeout: 15_000 });
    const noteHandle = await note.elementHandle();
    await frame.waitForFunction(el => el === el.getRootNode().activeElement, noteHandle, { timeout: 5000 }).catch(() => {});
    const opened = await frame.locator(named('Draft dialog')).isVisible();
    const focused = await note.evaluate(el => el === el.getRootNode().activeElement);
    const focusState = opened && focused ? '' : JSON.stringify(await note.evaluate(el => ({ active: el.getRootNode().activeElement?.tagName, label: el.getRootNode().activeElement?.getAttribute('aria-label'), root: el.getRootNode().nodeName })));
    check(opened && focused, `Dialog opens and focuses its field${focusState ? ` (${focusState})` : ''}`);
    await frame.fill(named('Note'), 'changed');
    const validity = await frame.locator(named('Draft dialog')).evaluate(dialog => {
      const field = dialog.querySelector('[aria-label="Note"]');
      const submit = dialog.querySelector('[aria-label="Save dialog"]');
      const form = dialog.querySelector('form');
      return { value: field.value, disabled: field.disabled, fieldsetDisabled: dialog.querySelector('fieldset').disabled, valid: field.validity.valid, formValid: form.checkValidity(), submitDisabled: submit.disabled, submitType: submit.type, associated: submit.form === form, contentEditable: submit.contentEditable, picking: document.documentElement.getAttribute('data-mx-annotate-picking'), status: dialog.querySelector('[role="status"]')?.textContent ?? null };
    });
    check(validity.value === 'changed' && !validity.disabled && validity.valid && validity.formValid && !validity.submitDisabled,
      `Dialog field is filled, enabled, and valid before submit (${JSON.stringify(validity)})`);
    await frame.click(named('Save dialog'));
    // set= changes Count on the click; the Dialog closes once its run= write has committed.
    await frame.waitForFunction(root => document.querySelector(`${root}[aria-label="Count"]`)?.textContent === '1' && document.querySelector(`${root}[aria-label="Draft dialog"]`)?.open === false, root, { timeout: 15_000 });
    check((await frame.locator(named('Draft dialog')).evaluate(el => el.open)) === false && (await frame.textContent(named('Positive'))) === 'positive', 'submit closes Dialog and set= drives && rendering');
    check(await frame.locator(named('Open dialog')).evaluate(el => el === document.activeElement), 'successful submit restores focus to the trigger');
    await frame.click(named('Open dialog'));
    await frame.press(named('Note'), 'Escape');
    await frame.waitForFunction(root => !document.querySelector(`${root}[aria-label="Draft dialog"]`)?.open, root);
    check(await frame.locator(named('Open dialog')).evaluate(el => el === document.activeElement), 'Escape closes Dialog and restores focus');
    const snapshots = routeBodies.filter(call => call.body?.localTables && Object.keys(call.body.localTables).length);
    check(snapshots.length === 0 && !routeBodies.some(call => call.url.endsWith('/mutate')), `${who}: local writes and the queries over them ran in the page: no local snapshot reached a route (${routeBodies.map(call => call.url.split('/').pop()).join(', ')})`);
    const addressed = await page.waitForFunction(() => new URLSearchParams(location.search).get('$count') === '1', null, { timeout: 5_000 }).then(() => true, () => false);
    check(addressed, `${who}: the page address carries the changed URL scalar (page ${new URL(page.url()).search}; the document frame's own address ${new URL(frame.url()).search})`);
    await page.reload({ waitUntil: 'load' });
    const reloaded = await documentFrame(page);
    await reloaded.waitForFunction(root => document.querySelector(`${root}[aria-label="Rows"]`)?.textContent?.trim() === '1', root, { timeout: 20_000 });
    const kept = { count: await reloaded.textContent(named('Count')), branch: await reloaded.textContent(named('Branch')) };
    check(kept.count === '1' && kept.branch === 'bee', `${who}: reload resets local rows while URL scalar changes persist (${JSON.stringify(kept)})`);
  };
  const anonymousLocal = lane('local SQL (anonymous)', async () => {
    const anonymous = await b.newPage();
    // "top-level" is gone: the app page frames every document on its own origin (lib/serving/document-frame).
    check((await anonymous.goto(`${B}/a/${lsDoc.id}`, { waitUntil: 'load' })).status() === 200, 'anonymous public document is served');
    await exercise(anonymous, 'anonymous', lsDoc.id);
    await anonymous.close();
  });

  const merged = await mergeGuestIntoAccount(ownerHome, B, ownerTok);
  check(merged === 200, 'owner adopted the guest connection');
  check(merged === 200, 'the owner adopted a guest connection');

  // ── DATAFLOW: the page, the private reader, the link that carries a selection ──
  const dataflow = lane('dataflow', async () => {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
    // Internal HTTP export pages lack this secure-context-only API. Exercise the
    // real runtime and the page script's start under that browser constraint.
    await p.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
    const pageErrors = [];
    p.on('pageerror', (e) => pageErrors.push(e.message));
    const relayCalls = [];
    const directCalls = [];
    p.on('request', (r) => {
      if (!r.url().includes(`/a/${doc.id}/query`)) return;
      if (r.method() === 'POST') relayCalls.push({ url: r.url(), body: r.postDataJSON() });
      if (r.method() === 'GET' && /[?&]q=/.test(r.url())) directCalls.push(r.url());
    });
    const docEngine = engineLoads(p);
    const docResp = documentResponse(p);
    await p.goto(`${B}/a/${doc.id}`, { waitUntil: 'load' });
    const csp = (await docResp.catch(() => null))?.headers()['content-security-policy'] ?? '';
    check(csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && !/(?:^|;)\s*sandbox(?:\s|;|$)/.test(csp), 'the framed document is served under the strict navigable document CSP');
    check(p.url() === `${B}/a/${doc.id}`, `URL unchanged, no redirect (${new URL(p.url()).pathname})`);
    const frame = await documentFrame(p);
    // PAINT FIRST: the page script's effect renders the rows the page already holds, then follows every change.
    await frame.waitForFunction(() => /rows=2/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
    check(/^page:function rows=2/.test(await frame.textContent('#out').catch(() => '')), `the page script's effect renders the query rows from the page signals (${await frame.textContent('#out').catch(() => '')})`);
    check(!pageErrors.some((e) => /hydrat/i.test(e)), 'no hydration error — the author script ran after the first commit');
    const options = await frame.$$eval('select[aria-label="Region"] option', (os) => os.map((o) => o.value + '=' + o.textContent));
    check(JSON.stringify(options) === JSON.stringify(['=All', 'EU=EU', 'NA=NA']), `the bound select lists the query (All + values): ${options.join(' ')}`);
    check((await frame.textContent('[aria-label="Live number"]')) === '$2,040', 'the Number aggregates the query result at first paint');
    // The reader may hold this public dataset: after the first paint the page fetches it once and runs every
    // later change itself, so the select below must make NO request at all.
    check(await docEngine, 'the page loaded its SQLite engine behind the first paint');
    await p.waitForTimeout(500);
    const callsBeforeChange = relayCalls.length + directCalls.length;
    await frame.evaluate(() => {
      const el = document.querySelector('[aria-label="Question embed"]');
      window.__busySeen = false; window.__flashSeen = false;
      new MutationObserver(() => {
        if (el.getAttribute('aria-busy') === 'true' && el.classList.contains('mx-busy')) window.__busySeen = true;
        if (/loading data/.test(el.textContent)) window.__flashSeen = true;
      }).observe(el, { attributes: true, subtree: true, childList: true, characterData: true });
    });
    await frame.selectOption('select[aria-label="Region"]', 'NA');
    await frame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$1,200', null, { timeout: 15000 }).catch(() => {});
    check((await frame.textContent('[aria-label="Live number"]')) === '$1,200', 'changing the select re-runs the query and the Number follows');
    const busy = await frame.evaluate(() => ({ seen: window.__busySeen, flash: window.__flashSeen, now: document.querySelector('[aria-label="Question embed"]').getAttribute('aria-busy') }));
    check(!busy.flash && busy.now === 'false', `the embed never flashed "loading" during the re-run and is not busy after it (busy seen=${busy.seen}, flash=${busy.flash})`);
    check(!/EU/.test(await frame.textContent('[aria-label="Data table"]')), 'and the table shows only the selected region');
    await frame.waitForFunction(() => document.getElementById('out')?.textContent === 'changed:NA', null, { timeout: 10000 }).catch(() => {});
    check((await frame.textContent('#out')) === 'changed:NA', `the page script's effect saw the bound select's change through the region signal (${await frame.textContent('#out')})`);
    const holds = relayCalls.filter((call) => call.body.hold !== undefined);
    check(directCalls.length === 0 && relayCalls.every((call) => call.body.hold !== undefined) && holds.length === 1 && holds[0].body.hold === 'regions_data',
      `the first paint's rows came with the page (no run request), and the page fetched the dataset it may hold ONCE through the scoped POST (${relayCalls.length} POST: ${JSON.stringify(relayCalls.map((c) => c.body.hold ?? c.body.only))}, ${directCalls.length} GET)`);
    check(relayCalls.length + directCalls.length === callsBeforeChange, `the select change ran in the page: no request (${relayCalls.length + directCalls.length - callsBeforeChange} made)`);
    await frame.selectOption('select[aria-label="Region"]', '');
    await frame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$2,040', null, { timeout: 15000 }).catch(() => {});
    check((await frame.textContent('[aria-label="Live number"]')) === '$2,040', 'back to All restores the whole result');
    const queryStatus = await frame.evaluate(async id => (await fetch(`/a/${id}/query?q=%7B%7D`)).status, doc.id);
    check(queryStatus === 200, `the document can query its own door (${queryStatus})`);

    // <DataTable> past the display window: a 40,000-row cross join ships 1,000 rows; sort and paging read
    // engine windows IN THE PAGE.
    const expectedMax = Math.max(...rows200.flatMap((a) => rows200.map((b_) => (a.revenue + b_.revenue) % 10007)));
    const pageCalls = [];
    p.on('request', (r) => { if (r.url().includes(`/a/${tdoc.id}/query`)) pageCalls.push({ method: r.method(), body: r.method() === 'POST' ? r.postDataJSON() : null }); });
    const tableEngine = engineLoads(p);
    await p.goto(`${B}/a/${tdoc.id}`, { waitUntil: 'load' });
    const f2 = await documentFrame(p);
    await f2.locator('[aria-label="Data grid"] tbody tr').first().waitFor({ timeout: 20000 });
    await f2.waitForTimeout(600);
    const domRows = await f2.$$eval('[aria-label="Data grid"] tbody tr', (trs) => trs.length);
    check(domRows > 0 && domRows < 200, `the table is virtualised (${domRows} DOM rows for 1,000 loaded)`);
    check(/1,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), `and honest about holding the display window of the result (${await f2.textContent('[aria-label="Row count"]')})`);
    check(await tableEngine, 'the table page loaded its SQLite engine');
    await f2.waitForTimeout(500);
    const tableCallsBefore = pageCalls.length;
    await f2.click('[aria-label="Sort by Revenue"]');
    await f2.click('[aria-label="Sort by Revenue"]');
    await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('500 of'), null, { timeout: 20000 }).catch(() => {});
    const topCell = await f2.$eval('[aria-label="Data grid"] tbody tr td:nth-child(3)', (td) => td.textContent);
    check(topCell === `$${expectedMax.toLocaleString('en-US')}`, `a header click sorts the WHOLE result through the engine (desc: ${topCell} first, expected $${expectedMax.toLocaleString('en-US')})`);
    await f2.click('[aria-label="Load more rows"]');
    await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('1,000 of'), null, { timeout: 20000 }).catch(() => {});
    check(/1,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), 'load more reads the next window');
    // Guest initialization may query via GET before the engine is ready; only requests caused by
    // sorting/paging belong to this assertion (fetch-transport tests cover initialization methods).
    check(pageCalls.length === tableCallsBefore, `sort and paging read their engine windows in the page (${pageCalls.length - tableCallsBefore} requests after the first paint)`);
    check(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
    await p.close();

    // Private document reader ACL with the same inline runtime: the owner account publishes it PRIVATE and
    // shares it with the second account.
    const pds = await j(await ownerPost('/api/artifacts', { dataset: [{ region: 'EU', revenue: 10 }, { region: 'NA', revenue: 20 }] }));
    const priv = await j(await ownerPost('/api/artifacts', { markup: doc1(pds.id), visibility: 'private' }));
    check(priv.visibility === 'private', `a private data document published (${priv.id})`);
    const shared = await ownerHome.evaluate(async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares: [{ email, role: 'viewer' }] }) })).status, [priv.id, SECOND_EMAIL]);
    check(shared === 200, 'the owner shared it with the reader');
    // The private document's own GET answering the uniform 404 moved to vitest: visibility.test.ts:127–134, api.test.ts:46–49.
    const reader = await secondCtx.newPage();
    const readerRelay = [];
    const readerDirect = [];
    reader.on('request', (r) => {
      if (!r.url().includes(`/a/${priv.id}/query`)) return;
      if (r.method() === 'POST') readerRelay.push(1);
      if (r.method() === 'GET') readerDirect.push(1);
    });
    const privResp = await reader.goto(`${B}/a/${priv.id}`, { waitUntil: 'load' });
    check(privResp.status() === 200, `the admitted reader opens the private document (${privResp.status()})`);
    await inlineStory(reader).catch(() => {});
    check((await documentLocator(reader).locator(INLINE_STORY).count()) === 1, 'the admitted private document renders in its frame after its ACL');
    const pf = await liveDocument(reader);
    await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$30', null, { timeout: 20000 }).catch(() => {});
    check((await pf.textContent('[aria-label="Live number"]').catch(() => '')) === '$30', 'the private document renders its server-run data for the reader');
    await pf.selectOption('select[aria-label="Region"]', 'NA');
    await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$20', null, { timeout: 15000 }).catch(() => {});
    check((await pf.textContent('[aria-label="Live number"]')) === '$20', 'the reader\'s re-run works through the PAGE');
    check(readerRelay.length >= 1 && readerDirect.length === 0, `…as a POST to the document's own door with the pages session (${readerRelay.length} POST, ${readerDirect.length} GET)`);
    await reader.close();

    // THE READER'S SELECTION TRAVELS IN THE LINK: `?$region=west` is parsed on the server, so the control is
    // right at FIRST PAINT and the one paint-first run goes out WITH the selection.
    const uds = await j(await ownerPost('/api/artifacts', { dataset: [{ region: 'west', revenue: 10 }, { region: 'east', revenue: 25 }] }));
    const udocSrc = `<Helmet><title>URL values gate</title><Value name="region" type="string" />
<Import name="regions_data" src="ref:${uds.id}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>
<Import name="sales_data" src="ref:${uds.id}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
</Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Regions</h1>
<select aria-label="Region" value="$region" options="$regions" />
<p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p></div>`;
    const udoc = await j(await ownerPost('/api/artifacts', { markup: udocSrc, visibility: 'public' }));
    check(!!udoc.id, `the URL-values document published (${udoc.url ?? udoc.error})`);
    // (a) a stranger's page, no session.
    const up = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const upErrors = [];
    up.on('pageerror', (e) => upErrors.push(e.message));
    const upQueries = [];
    up.on('request', (r) => { if (r.url().includes(`/a/${udoc.id}/query`)) upQueries.push({ method: r.method(), body: r.method() === 'POST' ? r.postDataJSON() : null }); });
    await up.goto(`${B}/a/${udoc.id}?$region=west`, { waitUntil: 'load' });
    const uf = await documentFrame(up);
    await uf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent?.startsWith('$'), null, { timeout: 20000 }).catch(() => {});
    check((await uf.$eval('select[aria-label="Region"]', (el) => el.value)) === 'west', `the link's selection is what the control shows at first paint (${await uf.$eval('select[aria-label="Region"]', (el) => el.value)})`);
    check((await uf.textContent('[aria-label="Live number"]')) === '$10', 'and the numbers are the SELECTED ones, not the defaults corrected a moment later');
    const upRuns = upQueries.filter((q) => q.body?.hold === undefined);
    check(upRuns.length === 0, `the document's first rows came with the page, for the selection: no run request (${upRuns.length} run request(s))`);
    // Key order is the store's: a compiled page's guest snapshot comes back from JSONB, which puts `errors` first.
    check(/"results":\{(?:"errors":\{\},)?"tables":\{"/.test(await (await fetch(`${documentOrigin(udoc.id)}/?$region=west`, { headers: { accept: 'text/html' } })).text()), 'and the served document carries those results for the linked selection');
    check(!upErrors.some((e) => /hydrat/i.test(e)), 'no hydration error: the SSR control and the hydrated store agree by construction');
    // (b) the address follows the reader
    await uf.selectOption('select[aria-label="Region"]', 'east');
    await uf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 15000 }).catch(() => {});
    await up.waitForFunction(() => location.search.includes('east'), null, { timeout: 5000 }).catch(() => {});
    check(up.url().includes('$region=east'), `picking rewrites the address (${new URL(up.url()).search}; the document frame's own address: ${new URL(uf.url()).search})`);
    check(!up.url().includes('west'), 'and replaces the old selection rather than appending to it');
    // (c) …and the link it produced is the document it describes
    await up.reload({ waitUntil: 'load' });
    const reloadedUf = await documentFrame(up);
    await reloadedUf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 20000 }).catch(() => {});
    check((await reloadedUf.$eval('select[aria-label="Region"]', (el) => el.value).catch(() => null)) === 'east', 'a reload of the copied address is the same document');
    check((await reloadedUf.textContent('[aria-label="Live number"]').catch(() => null)) === '$25', '…with the same numbers');
    await up.close();
    // (d) the owner's document has the same selection/address behavior and must not reload when a signal changes.
    const owner = await ownerCtx.newPage();
    let frameLoads = 0;
    owner.on('domcontentloaded', () => { frameLoads++; });
    await owner.goto(`${B}/a/${udoc.id}?$region=west`, { waitUntil: 'load' });
    const ownerFrame = await liveDocument(owner);
    await ownerFrame.evaluate(() => { window.__mxNoReload = 1; });
    await ownerFrame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent?.startsWith('$'), null, { timeout: 20000 }).catch(() => {});
    check(ownerFrame.url().includes('$region=west'), `the owner document receives the link's selection (${new URL(ownerFrame.url()).search})`);
    check((await ownerFrame.$eval('select[aria-label="Region"]', (el) => el.value)) === 'west', 'the owner control shows it');
    const loadsBefore = frameLoads;
    await ownerFrame.selectOption('select[aria-label="Region"]', 'east');
    await ownerFrame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 15000 }).catch(() => {});
    await owner.waitForFunction(() => location.search.includes('east'), null, { timeout: 5000 }).catch(() => {});
    check(owner.url().includes('$region=east'), `picking rewrites the page address (${new URL(owner.url()).search})`);
    const frameKept = await ownerFrame.evaluate(() => window.__mxNoReload === 1).catch(() => false);
    check(frameLoads === loadsBefore && frameKept, `…and the document was not reloaded to do it (${frameLoads - loadsBefore} page navigation(s), frame sentinel ${frameKept ? 'kept' : 'lost'}; the frame's own address: ${new URL(ownerFrame.url()).search})`);
    await owner.close();
    // (e) the EXPORT photographs the selection — and is not the cached default shot. (Not a generic render: the
    // selection reaching the exporter is this journey's; the generic PNG/JPEG/card set is gate-exports.mjs's.)
    const shot = async (search) => Buffer.from(await (await fetch(`${B}/a/${udoc.id}/export${search}`, { headers: { Authorization: `Bearer ${ownerTok}` } })).arrayBuffer());
    const [shotDefault, shotWest] = await Promise.all([shot(''), shot('?$region=west')]);
    check(shotDefault.length > 1000 && shotWest.length > 1000, `both exports rendered (${shotDefault.length} B, ${shotWest.length} B)`);
    check(!shotDefault.equals(shotWest), 'the selected export is a different picture from the default one');
  });

  // ── LOCAL SQL as the owner, then the dataset POLICY editor ─────────────────────
  const localAndPolicies = lane('local SQL (owner) and policies', async () => {
    const privateDoc = await j(await ownerPost('/api/artifacts', { markup: LOCAL_SOURCE, visibility: 'private' }));
    if (!privateDoc.id) throw new Error(`private fixture publish failed: ${JSON.stringify(privateDoc)}`);
    check((await ownerHome.evaluate(async id => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: 'read' }) })).status, lsDataset.id)) === 200, 'stored dataset was made read-only');
    const ownerLocal = await ownerCtx.newPage();
    await exercise(ownerLocal, 'owner', privateDoc.id);
    await ownerLocal.close();
    await anonymousLocal;
    const afterDoc = await j(await fetch(`${B}/api/artifacts/${lsDoc.id}`, { headers: OH }));
    const afterDataset = await j(await fetch(`${B}/api/artifacts/${lsDataset.id}`, { headers: OH }));
    check(afterDoc.version === lsDoc.version, `local edits did not bump the source version (${afterDoc.version})`);
    check(afterDataset.access === 'read' && afterDataset.rowCount === 1, 'local edits did not change stored dataset rows or permissions');
    const forbidden = await ownerPost(`/a/${aclDoc.id}/mutate`, { mutation: 'stored_write', args: {} });
    check(forbidden.status === 403, `persistent dataset mutation remains ACL-protected (${forbidden.status})`);
    // The anonymous fetch of the private document and its data route (the uniform 404) moved to vitest:
    // visibility.test.ts:127–134 and api.test.ts:46–49,190–196 (proposal §2).

    // POLICIES. The document's buttons and table live in its frame; the dataset's editor is the app's own page.
    // `until` polls a frame locator's state, which survives the frame reloading.
    const until = async (probe, timeout = 30_000) => {
      const end = Date.now() + timeout;
      while (!(await probe().catch(() => false))) {
        if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${probe}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    };
    const policyOwner = await b.newPage();
    await becomeOwner(policyOwner, B, tok);
    const guest = await b.newPage(), second = await b.newPage();
    await Promise.all([guest.goto(policyDoc.url), second.goto(policyDoc.url)]);
    const guestDoc = documentLocator(guest), secondDoc = documentLocator(second);
    const append = guestDoc.getByRole('button', { name: 'Append branch', exact: true });
    await step('a declared insert is disabled for a guest before any policy allows it', async () => {
      await append.waitFor();
      assert(await append.isDisabled());
    });
    const editor = await secondCtx.newPage();
    await step('an invited editor shares the dataset and edits insert-check conditions in the policy editor', async () => {
      const grant = await policyOwner.request.put(`${B}/api/my/artifacts/${policyDataset.id}/sharing`, { data: { shares: [{ email: SECOND_EMAIL, role: 'editor' }] } });
      assert.equal(grant.status(), 200);
      await editor.goto(`${B}/a/${policyDataset.id}/edit`);
      await editor.getByRole('button', { name: 'Open artifact controls', exact: true }).click();
      await editor.getByRole('dialog', { name: 'Artifact controls' }).getByRole('button', { name: 'Share', exact: true }).click();
      const recipient = 'mxmx_test_policy_recipient@example.com';
      await editor.getByLabel('Invite email').fill(recipient);
      await editor.getByLabel('Add email').click();
      await editor.getByLabel(`Role for ${recipient}`).click();
      await editor.getByRole('option', { name: /can edit/ }).click();
      // The role menu's PUT lands asynchronously; read the stored shares until it has (the original read once).
      let shares = [];
      for (const end = Date.now() + 10_000; Date.now() < end; await delay(200)) {
        shares = (await (await editor.request.get(`${B}/api/my/artifacts/${policyDataset.id}/sharing`)).json()).shares ?? [];
        if (shares.some(s => s.email === recipient && s.role === 'editor')) break;
      }
      assert(shares.some(s => s.email === recipient && s.role === 'editor'), `the recipient is stored as an editor (${JSON.stringify(shares)})`);
      await editor.getByLabel('Close sharing', { exact: true }).click();
      await editor.getByLabel('Dismiss artifact controls').click();
      await editor.getByLabel('Allow insert', { exact: true }).check();
      await editor.getByLabel('Add insert check condition', { exact: true }).click();
      await editor.getByLabel('insert check.1.1 value', { exact: true }).fill('"blocked"');
      await editor.getByLabel('Add insert check condition', { exact: true }).click();
      await editor.getByLabel('insert check.2.1 operator', { exact: true }).selectOption('_neq');
      await editor.getByLabel('insert check.2.1 value', { exact: true }).fill('"blocked"');
      await editor.getByLabel('Remove insert check.1.1 condition', { exact: true }).click();
      assert.equal(await editor.getByLabel('insert check.1.1 operator', { exact: true }).inputValue(), '_neq');
      await editor.getByRole('button', { name: 'Save access policies', exact: true }).click();
      await editor.getByText('Access policies saved.', { exact: true }).waitFor();
    });
    await step('public declared insert: the saved policy enables the guest\'s insert live, delete stays disabled, and the row reaches a second reader live and after reload', async () => {
      await until(() => append.isEnabled());
      assert(await guestDoc.getByRole('button', { name: 'Delete tree', exact: true }).isDisabled());
      await append.click();
      await secondDoc.getByText('new branch', { exact: true }).waitFor();
      await second.reload();
      await secondDoc.getByText('new branch', { exact: true }).waitFor();
    });
    await step('denied deletion/direct SQL: a forged delete mutation and direct SQL are refused', async () => {
      const forged = await guest.request.post(`${B}/a/${policyDoc.id}/mutate`, { data: { mutation: 'delete' } });
      assert(forged.status() >= 400);
      const raw = await fetch(`${B}/api/artifacts/${policyDataset.id}/mutate`, { method: 'POST', headers: H, body: JSON.stringify({ sql: `delete from public.rows` }) });
      assert(raw.status >= 400, 'editor without a matching policy cannot bypass it');
    });
    await step('live revocation: unchecking insert disables the guest\'s button without a reload', async () => {
      await editor.getByLabel('Allow insert', { exact: true }).uncheck();
      await editor.getByRole('button', { name: 'Save access policies', exact: true }).click();
      await until(() => append.isDisabled());
    });
    await step('persistence: the dataset title saves and the editor leaves /edit', async () => {
      await editor.reload();
      await editor.getByRole('button', { name: 'Source & models', exact: true }).click();
      await editor.getByLabel('Dataset title', { exact: true }).fill('Updated policy dataset');
      await editor.getByLabel('Save dataset', { exact: true }).click();
      await editor.getByRole('link', { name: 'Edit dataset', exact: true }).waitFor();
      await editor.waitForFunction(() => document.title === 'Updated policy dataset');
      assert(!new URL(editor.url()).pathname.endsWith('/edit'));
    });
    for (const page of [policyOwner, guest, second, editor]) await page.close();
  });

  // ── the DATA UX a person walks: dataset page, a chart over an upload, edit mode, owner chrome ──
  const dataUx = lane('data-ux', async () => {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
    await p.goto(B, { waitUntil: 'load' });
    await p.evaluate(() => localStorage.clear());
    // A browser's credential is the httpOnly session cookie, not a localStorage token.
    await becomeOwner(p, B, tok);
    check(!!made.id, `the dataset lands with a usable reference (${made.ref})`);
    // The create response must TELL the agent how to consume the dataset (the handshake; storage cases are
    // data-ingest-routes.test.ts's).
    check(made.ref === `ref:${made.id}`, `the create response carries the ref form (${made.ref})`);
    check((made.usage ?? '').includes(`<Import name="data" src="ref:${made.id}" /><Query name="rows">`)
      && /from\s+data\."rows"/i.test(made.usage ?? '')
      && /data="\$rows"/.test(made.usage ?? ''),
    'and an Import with a query over its rows + embed bound as data="$rows"');
    check(/vega-lite/.test(made.usage ?? ''), 'with a viz spec bound to the real columns');

    // The dataset PAGE: rows, not just headers.
    await p.goto(`${B}/a/${made.id}`, { waitUntil: 'load' });
    await p.locator('table tbody tr').nth(2).waitFor({ timeout: 15_000 }).catch(() => {});
    const rows = await p.locator('table tbody tr').count();
    check(rows === 3, `the dataset page renders ROWS, not just headers (${rows})`);
    check((await p.locator('[aria-label="Dataset summary"]').textContent()).includes('3 rows'), 'and says how many rows and columns');
    const tableText = await p.locator('table').innerText();
    check(tableText.includes('—'), 'a blank cell reads as missing, not as empty text');
    check(tableText.includes('01234'), 'leading zero preserved through ingest');
    check((await p.locator('[aria-label="Edit artifact"]').count()) === 0, 'no edit button on a dataset');
    await openMenu(p);
    check((await p.locator('[aria-label="Page bar"] [aria-label="Current page"]').first().textContent()).includes('Q3 Revenue'), 'the page bar carries the typed title as page context');
    await p.keyboard.press('Escape');
    const w = await p.evaluate(() => ({ d: document.documentElement.scrollWidth, w: window.innerWidth }));
    check(w.d <= w.w, 'no horizontal page scroll');
    // The catalog page follows stored row changes through its existing live stream.
    const writable = await fetch(`${B}/api/artifacts/${made.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ dataset: CSV, access: 'readwrite' }) });
    check(writable.status === 200, 'the owner can enable stored row edits');
    if (!writable.ok) throw new Error(`Enable writes: ${writable.status} ${await writable.text()}`);
    const changed = await fetch(`${B}/api/artifacts/${made.id}/mutate`, { method: 'POST', headers: H, body: JSON.stringify({ sql: `update public.rows set revenue=125 where month='2026-01'` }) });
    check(changed.status === 200, 'a stored row mutation succeeds');
    if (!changed.ok) throw new Error(`Mutate rows: ${changed.status} ${await changed.text()}`);
    await p.getByLabel('Table preview', { exact: true }).getByText('125', { exact: true }).waitFor();
    check((await p.getByLabel('Dataset table', { exact: true }).inputValue()) === 'rows', 'live rows refresh without navigating or losing table selection');

    // The whole seam: uploaded values reach a real Vega scale (a text `revenue` column draws and is wrong).
    {
      const markup = `<Helmet><Import name="rows_data" src="ref:${ingested.id}" /><Query name="rows">{\`select * from rows_data.rows\`}</Query></Helmet>`
        + '<div data-design="tw" className="@container p-10"><h1 className="text-4xl font-bold">Sales</h1>'
        + '<Question title="Revenue by month" data="$rows" '
        + 'viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"month","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} '
        + 'height="430px" /></div>';
      const put = await fetch(`${B}/api/artifacts/${chartSeed.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Sales', markup, theme: 'modernist' }) });
      check(put.status === 200, `the story accepts a Query over the uploaded dataset (${put.status})`);
      await p.goto(`${B}/a/${chartSeed.id}`, { waitUntil: 'load' });
      const surface = await documentFrame(p);
      await surface.waitForFunction(() => !!document.querySelector('svg.marks, canvas') && /2026-01/.test(document.body.innerText) && /\b(150|190|200)\b/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check((await surface.locator('svg.marks, canvas').count()) > 0, 'a real Vega chart rendered (not a fallback table)');
      const text = await surface.locator('body').innerText();
      check(/2026-01/.test(text), 'the x axis carries values from the uploaded CSV');
      check(/revenue/i.test(text), 'the y axis is labelled from the CSV header');
      check(/\b(150|190|200)\b/.test(text), 'the y scale is numeric — coercion survived into Vega');
    }

    // A chart must render in EDIT mode too, and never flash "data unavailable" while its refs load.
    {
      const mk = `<Helmet><Import name="rows_data" src="ref:${editData.id}" /><Query name="rows">{\`select * from rows_data.rows\`}</Query></Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Rev</h1><Question title="Revenue" data="$rows" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" /></div>`;
      await fetch(`${B}/api/artifacts/${editSeed.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Rev', markup: mk, theme: 'manuscript' }) });
      await p.goto(`${B}/a/${editSeed.id}`, { waitUntil: 'load' });
      await p.goto(`${B}/a/${editSeed.id}#edit`, { waitUntil: 'commit' });
      // The editor runs inside the document's frame (@mx/frame-editor). Take the frame as soon as it exists, before it
      // loads, so a "data unavailable" flash during loading is seen; re-resolved each poll in case the page replaces it.
      const editFrame = () => p.locator(DOCUMENT_FRAME).elementHandle({ timeout: 150 }).then((h) => h?.contentFrame() ?? null, () => null);
      let sawUnavailable = false;
      // Up to 30 s: the editor loads its chart engine beside the other legs on a loaded CI runner.
      for (let i = 0; i < 200; i++) {
        await p.waitForTimeout(150);
        const fr = await editFrame();
        const txt = fr ? await fr.locator('body').innerText({ timeout: 1000 }).catch(() => '') : '';
        if (/data unavailable/.test(txt)) sawUnavailable = true;
        if (fr && (await fr.locator('svg.marks, canvas').count().catch(() => 0))) break;
      }
      const ef = await editFrame();
      const marks = ef ? await ef.locator('svg.marks, canvas').count().catch(() => 0) : 0;
      const text = ef ? await ef.locator('body').innerText({ timeout: 5000 }).catch(() => '') : '';
      check(marks > 0, `a chart renders in EDIT mode (${marks} marks)`);
      check(!/data unavailable/.test(text), 'and does not say "data unavailable"');
      check(!sawUnavailable, 'and never flashed the failure message while loading');
    }
    await p.close();

    // A markup artifact still HAS an edit button — for its OWNER (a started document: its agent instructions).
    const st = await startDocument(B);
    const readerCtx = await b.newContext();
    const readerPage = await readerCtx.newPage();
    await readerPage.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
    check((await readerPage.locator('[aria-label="Edit this document"], [aria-label="Edit artifact"]').count()) === 0, 'a reader sees no edit chrome');
    await readerCtx.close();
    const ownerPage = await b.newPage({ viewport: { width: 1400, height: 1000 } });
    await becomeOwner(ownerPage, B, st.token);
    await ownerPage.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
    await openArtifactControls(ownerPage);
    // The controls panel fills in after it opens: wait for the fields rather than reading them at once.
    const shown = (locator) => locator.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    check(await shown(ownerPage.getByRole('textbox', { name: 'Agent instructions', exact: true })), 'a new artifact offers its owner editable agent instructions');
    check(await shown(ownerPage.getByRole('button', { name: 'Copy agent instructions', exact: true })), 'the owner can copy instructions for the first agent edit');
    await ownerPage.close();
  });

  // ── POSTGRESQL: connection → restricted dataset → filtered document → notifications ──
  const postgresLeg = lane('postgres', async () => {
    let secretsRead = 0;
    const secretFree = value => {
      secretsRead++;
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      assert.ok(!serialized.includes(adminPassword) && !serialized.includes(readerPassword), 'credentials must not appear in returned metadata or document markup');
      assert.ok(!serialized.includes('hidden-west') && !serialized.includes('hidden-east'), 'hidden source values must not appear in public output');
    };
    const ownerApi = async (page, path, method = 'GET', data) => page.evaluate(async ({ path, method, data }) => {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    }, { path, method, data });
    const guestApi = async (path, data) => {
      const response = await fetch(`${B}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    async function uiResponse(page, path, action, method = 'POST', expected = 200, requestFields = {}) {
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method
        && Object.entries(requestFields).every(([key, value]) => response.request().postDataJSON()?.[key] === value));
      await action();
      const response = await pending;
      const body = await response.json();
      secretFree(body);
      assert.equal(response.status(), expected, `${method} ${path}: ${JSON.stringify(body)}`);
      return body;
    }
    /** `scope` is the page (the dataset's own app page) or a document's frame (lib/page-facts documentFrame). */
    async function previewContains(scope, text, label = 'Table preview') {
      const preview = scope.getByLabel(label, { exact: true });
      await preview.waitFor();
      await scope.waitForFunction(({ label, text }) => [...document.querySelectorAll('[aria-label]')].some(node => node.getAttribute('aria-label') === label && node.textContent?.includes(text)), { label, text }).catch(async error => {
        const shown = (await preview.innerText()).slice(0, 300);
        secretFree(shown);
        console.error(`preview ${label} never showed ${text}: ${shown}`);
        throw error;
      });
    }
    // Default schema, result cache and source markup live under the editor's collapsed "Advanced" disclosure.
    const openAdvanced = async (page) => {
      const details = page.locator('details', { has: page.locator('summary', { hasText: 'Advanced' }) });
      if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
    };
    let port;
    if (!(await step('disposable Postgres has two schemas and a SELECT-only reader', async () => { port = await postgres; }))) return;
    const owner = await ownerCtx.newPage();
    await owner.goto(B, { waitUntil: 'domcontentloaded' });
    const guest = await b.newPage({ viewport: { width: 1280, height: 900 } });
    let datasetId, modelDatasetId;
    await step('dataset connection discovers schemas; selected columns and stable default schema persist into table picker', async () => {
      assert.equal((await ownerApi(owner, '/api/page/session', 'GET')).status, 200);
      await owner.goto(`${B}/datasets/new`, { waitUntil: 'load' });
      await owner.getByLabel('Dataset title', { exact: true }).fill('Postgres gate warehouse');
      await owner.getByLabel('PostgreSQL', { exact: true }).click();
      for (const [label, value] of Object.entries({ Host: '127.0.0.1', Port: String(port), Database: 'postgres', Username: 'dataset_reader', Password: readerPassword })) {
        await owner.getByLabel(label, { exact: true }).fill(value);
      }
      await owner.getByLabel('Use SSL', { exact: true }).uncheck();
      const secretResponse = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/my/secrets' && response.request().method() === 'POST');
      const discovery = await uiResponse(owner, '/api/my/datasets/discover', () => owner.getByLabel('Test and discover', { exact: true }).click());
      assert.match(await owner.getByLabel('Dataset connection', { exact: true }).getByRole('status').innerText(), /Connected.*2 tables/);
      const credential = await secretResponse;
      assert.equal(credential.status(), 201); secretFree(await credential.json());
      await owner.getByLabel('Password status', { exact: true }).waitFor();
      assert.equal(await owner.getByLabel('Password', { exact: true }).count(), 0);
      assert.deepEqual(discovery.tables.map(table => `${table.schema}.${table.name}`).sort(), ['sales.orders', 'support.tickets']);
      assert.equal(await owner.getByLabel('Expose table sales.orders', { exact: true }).isChecked(), false);
      await owner.getByLabel('Toggle table sales.orders', { exact: true }).click();
      for (const column of ['id', 'region', 'amount']) await owner.getByLabel(`Expose column sales.orders.${column}`, { exact: true }).check();
      assert.equal(await owner.getByLabel('Expose column sales.orders.customer_secret', { exact: true }).isChecked(), false);
      await openAdvanced(owner);
      await owner.getByLabel('Default schema', { exact: true }).selectOption('sales');
      await owner.getByLabel('Expose table support.tickets', { exact: true }).check();
      await owner.getByLabel('Toggle table support.tickets', { exact: true }).click();
      for (const column of ['id', 'subject']) assert.equal(await owner.getByLabel(`Expose column support.tickets.${column}`, { exact: true }).isChecked(), true);
      assert.equal(await owner.getByLabel('Default schema', { exact: true }).inputValue(), 'sales');
      await owner.getByLabel('Refresh interval', { exact: true }).fill('0');
      const created = await uiResponse(owner, '/api/my/artifacts', () => owner.getByLabel('Save dataset', { exact: true }).click(), 'POST', 201);
      datasetId = created.id; assert.ok(datasetId);
      await owner.waitForURL(url => url.pathname === `/a/${datasetId}`);
      await previewContains(owner, '120');
      assert.equal(await owner.getByLabel('Dataset schema', { exact: true }).inputValue(), 'sales');
      await owner.getByLabel('Dataset schema', { exact: true }).selectOption('support');
      await previewContains(owner, 'Refund requested');
      assert.equal(await owner.getByLabel('Dataset table', { exact: true }).inputValue(), 'tickets');
      await owner.getByLabel('Dataset schema', { exact: true }).selectOption('sales');
      await previewContains(owner, '120');
    });
    await step('read-only schema browser lists all exposed relations and columns without editor access', async () => {
      const metadata = await ownerApi(owner, `/api/my/artifacts/${datasetId}`);
      assert.equal(metadata.status, 200); secretFree(metadata.body);
      const exposed = metadata.body.meta.catalog.tables.find(table => table.schema === 'sales' && table.name === 'orders');
      assert.deepEqual(exposed.columns.map(column => column.name), ['id', 'region', 'amount']);
      assert.ok(metadata.body.meta.catalog.connection.passwordSecretId);
      assert.ok(!Object.hasOwn(metadata.body.meta.catalog.connection, 'password'));
      assert.equal((await guestApi(`/a/${datasetId}/tables`, { sql: 'select * from orders' })).status, 404, 'private dataset must reject an anonymous reader');
      assert.equal((await ownerApi(owner, `/api/my/artifacts/${datasetId}/sharing`, 'PUT', { visibility: 'unlisted' })).status, 200);
      await guest.goto(`${B}/a/${datasetId}`, { waitUntil: 'load' });
      await previewContains(guest, '120');
      await guest.getByLabel('Browse dataset schema', { exact: true }).click();
      const schemaBrowser = await guest.getByLabel('Dataset schema browser', { exact: true }).innerText();
      for (const name of ['sales', 'orders', 'region', 'amount', 'support', 'tickets', 'subject']) assert.ok(schemaBrowser.includes(name));
      assert.ok(!schemaBrowser.includes('customer_secret'));
      assert.equal(await guest.getByLabel('Edit dataset', { exact: true }).count(), 0);
    });
    await step('anonymous reader sees permitted source data and a typed Value filter reruns the remote query', async () => {
      const markup = '<Helmet><Value name="region" type="string" default="west" />'
        + `<Query name="orders" source="ref:${datasetId}">{\`select id, region, amount from orders where $region is null or region=$region order by id\`}</Query></Helmet>`
        + '<div data-design="tw" className="p-8"><h1>Regional orders</h1><input aria-label="Region" value="$region" /><DataTable data="$orders" /></div>';
      const published = await fetch(`${B}/api/artifacts/${pgSeed.id}`, { method: 'PUT', headers: OH, body: JSON.stringify({ title: 'Postgres sourced document', markup, visibility: 'unlisted' }) });
      const publication = await published.json();
      secretFree(publication);
      assert.equal(published.status, 200, `same-owner document must accept a sourced filtered query: ${JSON.stringify(publication)}`);
      await guest.goto(`${B}/a/${pgSeed.id}`, { waitUntil: 'load' });
      // The document is framed by the app page on its own origin: its table and its input live in that frame.
      const sourced = await documentFrame(guest);
      await previewContains(sourced, '120', 'DataTable embed');
      assert.ok(!(await sourced.getByLabel('DataTable embed', { exact: true }).innerText()).includes('90'));
      await sourced.locator('html[data-mx-ready]').waitFor();
      await sourced.getByLabel('Region', { exact: true }).fill('east');
      await previewContains(sourced, '90', 'DataTable embed');
      assert.ok(!(await sourced.getByLabel('DataTable embed', { exact: true }).innerText()).includes('120'));
      secretFree(await guest.content());
      secretFree(await sourced.content());
    });
    await step('forged reader queries cannot reach hidden columns, undeclared tables, catalogs or writes; database remains unchanged', async () => {
      for (const sql of ['select customer_secret from orders', "select id from orders where customer_secret='hidden-west'", 'select * from sales.internal_notes', 'select * from pg_catalog.pg_authid', 'delete from orders', 'with changed as (delete from orders returning *) select * from changed']) {
        const denied = await guestApi(`/a/${datasetId}/tables`, { sql });
        assert.equal(denied.status, 400, 'forged hidden-data or write query must be rejected'); secretFree(denied.body);
      }
      assert.equal((await admin.query('select count(*)::int as n from sales.orders')).rows[0].n, 3);
      assert.equal((await admin.query('select sum(amount)::int as n from sales.orders')).rows[0].n, 240);
    });
    await step('chained notebook cells roundtrip through markup; only the exposed final model reaches readers', async () => {
      // A fresh model-only dataset chooses its stable default schema at creation.
      await owner.goto(`${B}/datasets/new`, { waitUntil: 'load' });
      await owner.getByLabel('Dataset title', { exact: true }).fill('Postgres model-only notebook');
      await owner.getByLabel('PostgreSQL', { exact: true }).click();
      for (const [label, value] of Object.entries({ Host: '127.0.0.1', Port: String(port), Database: 'postgres', Username: 'dataset_reader', Password: readerPassword })) await owner.getByLabel(label, { exact: true }).fill(value);
      await owner.getByLabel('Use SSL', { exact: true }).uncheck();
      await uiResponse(owner, '/api/my/datasets/discover', () => owner.getByLabel('Test and discover', { exact: true }).click());
      await owner.getByLabel('Add notebook cell', { exact: true }).click();
      await owner.getByLabel('Cell name 1', { exact: true }).fill('raw_orders');
      await owner.getByLabel('Cell SQL 1', { exact: true }).fill('select region, amount from sales.orders');
      await uiResponse(owner, '/api/my/datasets/notebook/preview', () => owner.getByLabel('Cell SQL 1', { exact: true }).press('Control+Enter'));
      await previewContains(owner, '120', 'Cell preview 1');
      assert.equal(await owner.getByLabel('Expose cell 1', { exact: true }).isChecked(), false);
      await owner.getByLabel('Add notebook cell', { exact: true }).click();
      await owner.getByLabel('Cell name 2', { exact: true }).fill('region_totals');
      await owner.getByLabel('Cell SQL 2', { exact: true }).fill('select region, sum(amount)::int as total from raw_orders group by region order by region');
      await uiResponse(owner, '/api/my/datasets/notebook/preview', () => owner.getByLabel('Cell SQL 2', { exact: true }).press('Meta+Enter'));
      await previewContains(owner, '150', 'Cell preview 2');
      await owner.getByLabel('Expose cell 2', { exact: true }).check();
      assert.equal(await owner.getByLabel('Expose table models.region_totals', { exact: true }).isChecked(), true);
      // Publish only the final model. The intermediate cell and physical tables stay internal.
      await owner.getByLabel('Expose schema sales', { exact: true }).uncheck();
      await owner.getByLabel('Expose schema support', { exact: true }).uncheck();
      await openAdvanced(owner);
      await owner.getByLabel('Default schema', { exact: true }).selectOption('models');
      await owner.getByRole('button', { name: 'Data preview', exact: true }).click();
      await owner.getByLabel('SQL view', { exact: true }).click();
      await owner.getByLabel('Dataset SQL', { exact: true }).fill('select * from models.region_totals');
      await uiResponse(owner, '/api/my/datasets/preview', () => owner.getByLabel('Run dataset SQL', { exact: true }).click(), 'POST', 200, { sql: 'select * from models.region_totals' });
      await previewContains(owner, '150');
      await owner.getByLabel('Dataset SQL', { exact: true }).fill('select * from sales.orders');
      const deniedDraft = await uiResponse(owner, '/api/my/datasets/preview', () => owner.getByLabel('Run dataset SQL', { exact: true }).click(), 'POST', 400, { sql: 'select * from sales.orders' });
      assert.ok(deniedDraft.error);
      assert.equal(await owner.getByLabel('Dataset SQL', { exact: true }).inputValue(), 'select * from sales.orders');
      await owner.getByRole('button', { name: 'Source & models', exact: true }).click();
      await openAdvanced(owner);
      await owner.getByLabel('Edit dataset source', { exact: true }).click();
      const source = await owner.getByLabel('Dataset source', { exact: true }).inputValue();
      assert.match(source, /<Dataset/); assert.match(source, /raw_orders/); secretFree(source);
      await owner.getByLabel('Apply dataset source', { exact: true }).click();
      const modelCreated = await uiResponse(owner, '/api/my/artifacts', () => owner.getByLabel('Save dataset', { exact: true }).click(), 'POST', 201);
      modelDatasetId = modelCreated.id;
      await owner.waitForURL(url => url.pathname === `/a/${modelDatasetId}`);
      assert.equal((await ownerApi(owner, `/api/my/artifacts/${modelDatasetId}/sharing`, 'PUT', { visibility: 'unlisted' })).status, 200);
      assert.equal(await owner.getByLabel('Dataset schema', { exact: true }).inputValue(), 'models');
      assert.equal(await owner.getByLabel('Dataset table', { exact: true }).inputValue(), 'region_totals');
      await previewContains(owner, '150');
      const publicPage = await fetch(`${B}/api/page/artifact/${modelDatasetId}`).then(response => response.json());
      secretFree(publicPage);
      const publicCatalog = publicPage.surface.catalog;
      assert.equal(publicCatalog.tables.length, 1);
      assert.ok(!Object.hasOwn(publicCatalog, 'notebook'));
      assert.ok(!Object.hasOwn(publicCatalog, 'notebookSources'));
      assert.ok(!JSON.stringify(publicPage).includes('raw_orders'));
      for (const sql of ['select * from sales.orders', 'select * from raw_orders']) assert.equal((await guestApi(`/a/${modelDatasetId}/tables`, { sql })).status, 400);
    });
    await step('manual refresh reads an external database update; model metadata stays credential-free', async () => {
      await admin.query('update sales.orders set amount=125 where id=1');
      const refreshed = await uiResponse(owner, `/a/${modelDatasetId}/tables`, () => owner.getByLabel('Refresh dataset', { exact: true }).click(), 'POST', 200, { refresh: true });
      assert.equal(refreshed.rows.find(row => row.region === 'west').total, 155);
      await previewContains(owner, '155');
      assert.match(await owner.getByLabel('Refresh status', { exact: true }).innerText(), /Last refreshed.*Manual refresh/);
      const finalMetadata = await ownerApi(owner, `/api/my/artifacts/${modelDatasetId}`); secretFree(finalMetadata.body);
      assert.ok(finalMetadata.body.meta.catalog.tables.some(table => table.name === 'region_totals'));
    });
    // Notifications use the very same native catalog interface as Query. Writes still target a stored dataset.
    const recipient = await secondCtx.newPage();
    await recipient.goto(B, { waitUntil: 'domcontentloaded' });
    const checked = async (page, path, method = 'GET', data, status = 200) => {
      const result = await ownerApi(page, path, method, data);
      secretFree(result.body);
      assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.body)}`);
      return result.body;
    };
    let recipientId, notice, trigger;
    const run = async (documentId = notice.id) => {
      const result = await checked(owner, `/a/${documentId}/mutate`, 'POST', notificationMutationPayload(recipientId));
      assert.equal(typeof result.mutationRunId, 'string');
      return result.mutationRunId;
    };
    const settled = async runId => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const { jobs } = await checked(owner, `/api/notification-runs/${runId}/jobs`);
        assert.equal(jobs.length, 1, 'one durable job evaluates every linked rule');
        if (['completed', 'failed'].includes(jobs[0].status)) return jobs[0];
        await delay(100);
      }
      throw new Error(`Notification run ${runId} did not settle`);
    };
    const inbox = async runId => (await checked(recipient, '/api/my/people')).notifications.filter(item => item.kind === 'mutation' && item.mutation_run_id === runId);
    let successRun;
    await step('native PostgreSQL arrays, native concatenation, and chained notebook models combine distinct messages once per recipient/run', async () => {
      recipientId = (await ownerApi(recipient, '/api/page/session')).body.user.id;
      trigger = await checked(owner, '/api/my/artifacts', 'POST', {
        access: 'readwrite',
        dataset: '<Dataset kind="stored"><Table schema="public" name="rows" columns={[{"name":"id","type":"number"},{"name":"recipient","type":"string"}]} rows={[{"id":1,"recipient":"initial"}]} /></Dataset>',
      }, 201);
      // The stored import is also a required readable source.
      await checked(owner, `/api/my/artifacts/${trigger.id}/sharing`, 'PUT', { visibility: 'unlisted' });
      notice = await checked(owner, '/api/my/artifacts', 'POST', notificationDocumentPayload({ triggerId: trigger.id, recipientId, modelDatasetId, datasetId }), 201);
      await checked(recipient, `/api/my/artifacts/${notice.id}/members`, 'POST', { action: 'join' });
      await checked(owner, `/api/my/artifacts/${notice.id}/members`, 'POST', { action: 'approve', userId: recipientId });
      successRun = await run();
      const successJob = await settled(successRun);
      assert.equal(successJob.status, 'completed');
      assert.deepEqual([...successJob.notification_names].sort(), ['duplicate_notice', 'model_notice', 'physical_notice']);
      const delivered = await inbox(successRun);
      assert.equal(delivered.length, 1, 'one recipient gets one item across three rules and duplicate array entries');
      assert.deepEqual([...delivered[0].messages].sort(), ['Order 1', 'West total 155']);
    });
    await step('current native-source authority gates both delivery and disclosure', async () => {
      await checked(owner, `/api/my/artifacts/${modelDatasetId}/sharing`, 'PUT', { visibility: 'private' });
      assert.equal((await inbox(successRun)).length, 0, 'disclosure rechecks the current native source authority');
      const deniedRun = await run();
      assert.equal((await settled(deniedRun)).status, 'completed');
      assert.equal((await inbox(deniedRun)).length, 0, 'one unreadable source suppresses the whole combined item');
      await checked(owner, `/api/my/artifacts/${modelDatasetId}/sharing`, 'PUT', { visibility: 'unlisted' });
      assert.equal((await inbox(deniedRun)).length, 0, 'restoring source access does not backfill a suppressed run');
    });
    await step('PostgreSQL JSON text fails the job without partial sibling-rule delivery', async () => {
      const invalidNotice = await checked(owner, '/api/my/artifacts', 'POST', notificationDocumentPayload({ triggerId: trigger.id, recipientId, modelDatasetId, datasetId, invalid: true }), 201);
      await checked(recipient, `/api/my/artifacts/${invalidNotice.id}/members`, 'POST', { action: 'join' });
      await checked(owner, `/api/my/artifacts/${invalidNotice.id}/members`, 'POST', { action: 'approve', userId: recipientId });
      const invalidRun = await run(invalidNotice.id);
      assert.equal((await settled(invalidRun)).status, 'failed', 'JSON text is not a typed recipient list');
      assert.equal((await inbox(invalidRun)).length, 0, 'a failed rule publishes no partial messages from successful sibling rules');
    });
    // Every output read above went through secretFree; a leak fails the step that read it, naming this label.
    check(secretsRead > 20, `credentials must not appear in returned metadata or document markup (${secretsRead} outputs read)`);
    check(secretsRead > 20, `hidden source values must not appear in public output (${secretsRead} outputs read)`);
    for (const page of [owner, guest, recipient]) await page.close();
  });

  await Promise.all([anonymousLocal, dataflow, localAndPolicies, dataUx, postgresLeg]);

  // ── the booking document's day click, alone: under 50 ms, and no request ────────
  await lane('booking', async () => {
    const bp = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const bookingRequests = [];
    bp.on('request', (r) => bookingRequests.push(r.url()));
    const bookingEngine = engineLoads(bp);
    await bp.goto(`${B}/a/${booking.id}`, { waitUntil: 'load' });
    const bf = await documentFrame(bp);
    await bf.locator('main h2').first().waitFor({ timeout: 20000 });
    check(await bookingEngine, 'the booking page loaded its SQLite engine');
    await bp.waitForTimeout(500);
    /** Click the i-th day and time, in the page, from the click to the heading showing a different day. */
    const clickDay = (i) => bf.evaluate((i) => new Promise((resolve) => {
      const days = [...document.querySelectorAll('main button')].filter((el) => /\d/.test(el.textContent ?? '') && !/Cancel|:/.test(el.textContent ?? ''));
      const heading = () => document.querySelector('main h2')?.textContent;
      const before = heading();
      const t0 = performance.now();
      const seen = new MutationObserver(() => { if (heading() !== before) { seen.disconnect(); resolve({ ms: performance.now() - t0, days: days.length }); } });
      seen.observe(document.querySelector('main'), { subtree: true, childList: true, characterData: true });
      days[i % days.length].click();
      setTimeout(() => { seen.disconnect(); resolve({ ms: Infinity, days: days.length }); }, 5000);
    }), i);
    for (let i = 1; i <= 3; i++) await clickDay(i); // warm-up: the engine's first runs compile their statements
    bookingRequests.length = 0;
    const clicks = [];
    for (let i = 4; i < 10; i++) clicks.push(await clickDay(i));
    const worst = Math.max(...clicks.map((c) => c.ms));
    check(clicks[0].days >= 10 && worst < 50, `a day click shows its first change in under 50 ms after warm-up (${clicks.map((c) => Math.round(c.ms)).join(', ')} ms over ${clicks[0].days} days)`);
    check(bookingRequests.length === 0, `and makes no request at all (${bookingRequests.length}: ${bookingRequests.slice(0, 3).join(' ')})`);
    await bp.close();
  });
  // Unknown ids answering the uniform 404 (POST and GET) moved to vitest: api.test.ts:46–49,190–196.
} finally {
  try {
    await Promise.allSettled([b.close(), admin?.end()]);
    sink.close();
  } finally {
    await postgres.catch(() => {});
    if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  }
}
check.done();
