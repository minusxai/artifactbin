/**
 * Gate: the DATAFLOW, end to end in a real browser — the durable form of what
 * the feature was verified with while it was built.
 *
 *  1. publish: a document declaring <Value>/<Query> over a dataset, bound by
 *     $name — and a bad column is refused at the door with the engine's own
 *     diagnostic (invalid_sql, candidate columns named);
 *  2. the reader's document, served TOP-LEVEL (no iframe — proxy.ts): options
 *     from a query, a Number and a chart over the result, window.mx defined
 *     from the author script's first line, NO hydration error;
 *  3. the document fetches for ITSELF: changing the bound select re-runs the
 *     query by GET /a/<id>/query?q= straight from the sandboxed document (no
 *     parent, no relay), the Number/table follow, back to All restores — and
 *     the CSP admits exactly that URL: /a/<id>/start and /api are blocked
 *     from inside the document;
 *  4. <DataTable> over a result past the cap: virtualised (DOM rows ≪ rows),
 *     "N of M", an engine-sorted window on header click, load-more paging —
 *     all through the same direct GET;
 *  5. the reader ACL on that GET: a private document is the uniform 404 with
 *     no credential — and, from the browser, its admitted reader gets the
 *     SHELL (iframe + relay POST with the session), because the document's
 *     own anonymous GET cannot answer for a private document;
 *  6. an unknown id is the uniform 404 either way.
 *
 *   usage: node scripts/gate-dataflow.mjs [base]
 *   (local dev and gates read the protected development outbox)

 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { out.push(`${c ? '  ok ' : 'FAIL'} ${l}`); return c; };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; } };
const tok = (await j(await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' }))).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const api = (path, body) => fetch(`${B}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

// ── 1. publish ──────────────────────────────────────────────────────────────
const ds = await j(await api('/api/artifacts', { dataset: [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }] }));
ok(!!ds.id, 'the dataset published');
const doc1 = (ds_) => `<Helmet><title>Dataflow gate</title><Value name="region" type="string" />
<Query name="regions">{\`select distinct region from ref_${ds_} order by 1\`}</Query>
<Query name="sales">{\`select region, sum(revenue) revenue from ref_${ds_} where $region is null or region = $region group by 1 order by 1\`}</Query>
<script>{\`var out = document.getElementById('out'); var changed = false; function show() { if (changed) return; var t = mx.data.get('sales'); out.textContent = 'mx:' + (typeof mx) + ' rows=' + (t ? t.rows.length : 0); } show(); mx.data.subscribe(show); mx.params.subscribe(function (v) { changed = true; out.textContent = 'changed:' + v.region; });\`}</script>
</Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Sales</h1>
<select aria-label="Region" value="$region" options="$regions" />
<p id="out">pending</p>
<p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<Question title="Revenue by region" data="$sales" viz={{"kind":"table"}} height="300px" /></div>`;
const doc = await j(await api('/api/artifacts', { markup: doc1(ds.id) }));
ok(!!doc.id, `the dataflow document published (${doc.url ?? doc.error})`);
const bad = await api('/api/artifacts', { markup: doc1(ds.id).replace('sum(revenue)', 'sum(revenu)') });
const badBody = await j(bad);
ok(bad.status === 400 && badBody.error === 'invalid_sql' && /revenu.*Candidate.*revenue/s.test(JSON.stringify(badBody.details)),
  'a bad column is refused at publish with the engine diagnostic naming candidates');
const retired = await api('/api/artifacts', { markup: `<Question data="ref:${ds.id}" />` });
const retiredBody = await j(retired);
ok(retired.status === 400 && /<Query name="rows">/.test(retiredBody.details?.[0]?.message ?? ''), 'data="ref:" is retired and the 400 names the <Query> replacement');

// ── 2 + 3. the reader's TOP-LEVEL document, fetching for itself ─────────────
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(e.message));
const relayCalls = [];
const directCalls = [];
p.on('request', (r) => {
  if (!r.url().includes(`/a/${doc.id}/query`)) return;
  if (r.method() === 'POST') relayCalls.push(r.url());
  if (r.method() === 'GET' && /[?&]q=/.test(r.url())) directCalls.push(r.url());
});
const resp = await p.goto(`${B}/a/${doc.id}`, { waitUntil: 'load' });
const csp = resp.headers()['content-security-policy'] ?? '';
ok(csp.includes('sandbox') && csp.includes(`connect-src ${B}/a/${doc.id}/query`), 'the reader\'s document is served top-level under the sandbox CSP, connect-src = its own query url');
ok((await p.locator('iframe[title="artifact"]').count()) === 0, 'no iframe: the public data document IS the page');
ok(p.url() === `${B}/a/${doc.id}`, `URL unchanged, no redirect (${new URL(p.url()).pathname})`);
const frame = p.mainFrame();
/*
 * PAINT FIRST moved what an author script finds at startup. The rows are no
 * longer inlined, so `mx.data.get()` is empty for the round trip it takes to
 * fetch them — a script that needs them SUBSCRIBES, which is what the document
 * above does and what /docs/llm teaches. The script still runs at the first
 * commit; only the data is late.
 */
await frame.waitForFunction(() => document.getElementById('out')?.textContent?.startsWith('mx:'), null, { timeout: 20000 }).catch(() => {});
ok(/^mx:object /.test(await frame.textContent('#out').catch(() => '')), 'window.mx is defined when the author script runs');
await frame.waitForFunction(() => /rows=2/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
ok(/^mx:object rows=2/.test(await frame.textContent('#out').catch(() => '')), 'and its query rows reach the script through mx.data.subscribe');
ok(!pageErrors.some((e) => /hydrat/i.test(e)), 'no hydration error — the author script ran after the first commit');
const options = await frame.$$eval('select[aria-label="Region"] option', (os) => os.map((o) => o.value + '=' + o.textContent));
ok(JSON.stringify(options) === JSON.stringify(['=All', 'EU=EU', 'NA=NA']), `the bound select lists the query (All + values): ${options.join(' ')}`);
ok((await frame.textContent('[aria-label="Live number"]')) === '$2,040', 'the Number aggregates the query result at first paint');
// Watch the embed for the transient busy state: it must go busy (dimmed,
// "updating…") while the re-run is in flight and come back — with its old
// rows on screen the whole time, never a flash to "loading".
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
ok((await frame.textContent('[aria-label="Live number"]')) === '$1,200', 'changing the select re-runs the query and the Number follows');
const busy = await frame.evaluate(() => ({ seen: window.__busySeen, flash: window.__flashSeen, now: document.querySelector('[aria-label="Question embed"]').getAttribute('aria-busy') }));
ok(busy.seen && !busy.flash && busy.now === 'false', `the embed showed the busy state during the re-run and cleared it (busy=${busy.seen}, flash=${busy.flash})`);
ok(!/EU/.test(await frame.textContent('[aria-label="Data table"]')), 'and the table shows only the selected region');
ok((await frame.textContent('#out')) === 'changed:NA', 'the author script saw the change through mx.params.subscribe');
ok(directCalls.length >= 1 && relayCalls.length === 0, `the re-run was the DOCUMENT'S OWN GET /a/<id>/query?q= (${directCalls.length} direct, ${relayCalls.length} relayed)`);
await frame.selectOption('select[aria-label="Region"]', '');
await frame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$2,040', null, { timeout: 15000 }).catch(() => {});
ok((await frame.textContent('[aria-label="Live number"]')) === '$2,040', 'back to All restores the whole result');
// The CSP admits exactly the query url — from INSIDE the sandboxed document.
const reach = await frame.evaluate(async (id) => {
  const tryFetch = async (url, init) => { try { const r = await fetch(url, init); return String(r.status); } catch { return 'blocked'; } };
  return {
    query: await tryFetch(`/a/${id}/query?q=${encodeURIComponent('{}')}`),
    start: await tryFetch(`/a/${id}/start`, { method: 'POST' }),
    api: await tryFetch('/api/tokens/anonymous', { method: 'POST' }),
    other: await tryFetch('/a/zzzzzz/query?q=%7B%7D'),
  };
}, doc.id);
ok(reach.query === '200', `the document may fetch its own query url (${reach.query})`);
ok(reach.start === 'blocked' && reach.api === 'blocked' && reach.other === 'blocked', `…and nothing else on the origin: start=${reach.start} api=${reach.api} other-doc=${reach.other}`);

// ── 4. <DataTable> past the cap, through the same direct GET ───────────────
// A dataset can never exceed the ingest cap (MAX_ROWS_LIMIT), and the query cap
// defaults to the same number — so a result past the cap comes from the QUERY:
// a cross join of a 200-row dataset is 40,000 rows, 10,000 of which the island
// carries, and the rest are read as engine windows.
const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, region: ['EU', 'NA', 'APAC'][i % 3], revenue: (i * 7919) % 10007 }));
const big = await j(await api('/api/artifacts', { dataset: rows }));
const expectedMax = Math.max(...rows.flatMap((a) => rows.map((b_) => (a.revenue + b_.revenue) % 10007)));
const tdoc = await j(await api('/api/artifacts', { markup: `<Helmet><Query name="all">{\`select a.id * 200 + b.id as id, a.region, (a.revenue + b.revenue) % 10007 as revenue from ref_${big.id} a cross join ref_${big.id} b order by 1\`}</Query></Helmet>
<div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Big table</h1>
<DataTable data="$all" height="360px" columns={[{"col":"id","title":"ID"},{"col":"region","title":"Region"},{"col":"revenue","title":"Revenue","fmt":"$,.0f","bar":true}]} /></div>` }));
ok(!!tdoc.id, 'the DataTable document published');
const pageGets = [];
p.on('request', (r) => { if (r.url().includes(`/a/${tdoc.id}/query`) && r.method() === 'GET') pageGets.push(r.url()); });
await p.goto(`${B}/a/${tdoc.id}`, { waitUntil: 'load' });
ok((await p.locator('iframe[title="artifact"]').count()) === 0, 'the table document is top-level too');
const f2 = p.mainFrame();
await f2.waitForFunction(() => typeof window.mx === 'object', null, { timeout: 20000 });
await f2.waitForTimeout(600);
const domRows = await f2.$$eval('[aria-label="Data grid"] tbody tr', (trs) => trs.length);
ok(domRows > 0 && domRows < 200, `the table is virtualised (${domRows} DOM rows for 10,000 loaded)`);
ok(/10,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), 'and honest about holding a sample of the result');
await f2.click('[aria-label="Sort by Revenue"]');
await f2.click('[aria-label="Sort by Revenue"]');
await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('500 of'), null, { timeout: 20000 }).catch(() => {});
const topCell = await f2.$eval('[aria-label="Data grid"] tbody tr td:nth-child(3)', (td) => td.textContent);
ok(topCell === `$${expectedMax.toLocaleString('en-US')}`, `a header click sorts the WHOLE result through the engine (desc: ${topCell} first, expected $${expectedMax.toLocaleString('en-US')})`);
await f2.click('[aria-label="Load more rows"]');
await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('1,000 of'), null, { timeout: 20000 }).catch(() => {});
ok(/1,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), 'load more reads the next window');
ok(pageGets.length >= 2, `sort and paging went through the document's own GET (${pageGets.length} calls)`);
ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

// ── 5. the reader ACL: a PRIVATE data document keeps the shell ──────────────
// Owner: an account that claims a token, publishes the same document PRIVATE,
// shares it with a reader. Reader: a second account. The reader's page must be
// the SHELL (iframe) and its re-runs the PAGE's relay POST — the anonymous GET
// is a 404 for a private document.
const sink = await startMailSink();
const stamp = Date.now().toString(36);
const ownerCtx = await b.newContext();
const owner = await ownerCtx.newPage();
await loginViaEmail(owner, B, sink, `mxmx_test_dataflow_owner_${stamp}@example.com`);
const ownerTok = (await j(await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' }))).token;
const claimed = await owner.evaluate(async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status, ownerTok);
ok(claimed === 200, 'the owner claimed a token');
const OH = { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' };
const pds = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ dataset: [{ region: 'EU', revenue: 10 }, { region: 'NA', revenue: 20 }] }) }));
const priv = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ markup: doc1(pds.id), visibility: 'private' }) }));
ok(priv.visibility === 'private', `a private data document published (${priv.id})`);
const readerEmail = `mxmx_test_dataflow_reader_${stamp}@example.com`;
const shared = await owner.evaluate(async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares: [email] }) })).status, [priv.id, readerEmail]);
ok(shared === 200, 'the owner shared it with the reader');
const anonGet = await fetch(`${B}/a/${priv.id}/query?q=%7B%7D`);
ok(anonGet.status === 404, `the document's own GET is the uniform 404 for a private document (${anonGet.status})`);
const readerCtx = await b.newContext();
const reader = await readerCtx.newPage();
await loginViaEmail(reader, B, sink, readerEmail);
const readerRelay = [];
const readerDirect = [];
reader.on('request', (r) => {
  if (!r.url().includes(`/a/${priv.id}/query`)) return;
  if (r.method() === 'POST') readerRelay.push(1);
  if (r.method() === 'GET') readerDirect.push(1);
});
const privResp = await reader.goto(`${B}/a/${priv.id}`, { waitUntil: 'load' });
ok(privResp.status() === 200, `the admitted reader opens the private document (${privResp.status()})`);
ok((await reader.locator('iframe[title="artifact"]').count()) === 1, 'and gets the SHELL — the private data document stays in the iframe');
const pf = await (await reader.waitForSelector('iframe[title="artifact"]')).contentFrame();
await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$30', null, { timeout: 20000 }).catch(() => {});
ok((await pf.textContent('[aria-label="Live number"]').catch(() => '')) === '$30', 'the private document renders its server-run data for the reader');
await pf.selectOption('select[aria-label="Region"]', 'NA');
await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$20', null, { timeout: 15000 }).catch(() => {});
ok((await pf.textContent('[aria-label="Live number"]')) === '$20', 'the reader\'s re-run works through the PAGE');
ok(readerRelay.length >= 1 && readerDirect.length === 0, `…as the relay POST with the session (${readerRelay.length} relayed, ${readerDirect.length} direct)`);
await ownerCtx.close(); await readerCtx.close();
sink.close();
await b.close();

// ── 6. unknown ids ──────────────────────────────────────────────────────────
const nope = await fetch(`${B}/a/zzzzzz/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: {} }) });
ok(nope.status === 404, 'an unknown id is the uniform 404 (POST)');
ok((await fetch(`${B}/a/zzzzzz/query?q=%7B%7D`)).status === 404, 'an unknown id is the uniform 404 (GET)');

console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
