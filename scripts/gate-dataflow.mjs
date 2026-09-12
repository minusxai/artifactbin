import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Dataflow browser gate: publish diagnostics; signal/query subscriptions;
 * authenticated document-scoped POST transport; virtualized engine windows;
 * private-reader ACL; URL selection round trips and selected exports.
 * Artifact markup renders inline in the trusted app. Author code remains in
 * managed sandboxed child frames, whose direct network CSP is tested there.
 * Usage: node scripts/gate-dataflow.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { out.push(`${c ? '  ok ' : 'FAIL'} ${l}`); return c; };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; } };
const tok = (await connectAgent(B)).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const api = (path, body) => fetch(`${B}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

// ── 1. publish ──────────────────────────────────────────────────────────────
const ds = await j(await api('/api/artifacts', { dataset: [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }] }));
ok(!!ds.id, 'the dataset published');
const doc1 = (ds_) => `<Helmet><title>Dataflow gate</title><Value name="region" type="string" />
<Query name="regions" source="ref:${ds_}">{\`select distinct region from public.rows order by 1\`}</Query>
<Query name="sales" source="ref:${ds_}">{\`select region, sum(revenue) revenue from public.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
</Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Sales</h1>
<select aria-label="Region" value="$region" options="$regions" />
<Iframe title="Dataflow script" height={100}><p id="out">pending</p><script>{\`var out = document.getElementById('out'); var changed = false; function show() { if (changed) return; var t = mx.data.get('sales'); out.textContent = 'mx:' + (typeof mx) + ' rows=' + (t ? t.rows.length : 0); } show(); mx.data.subscribe(['sales'], show); mx.params.subscribe(['region'], function (v) { changed = true; out.textContent = 'changed:' + v.region; });\`}</script></Iframe>
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
ok(retired.status === 400 && /<Query name="rows"[^>]*source="ref:/.test(retiredBody.details?.[0]?.message ?? ''), 'data="ref:" is retired and the 400 names the <Query> replacement');

// ── 2 + 3. inline document and scoped authenticated transport ──────────────
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(e.message));
const relayCalls = [];
const directCalls = [];
p.on('request', (r) => {
  if (!r.url().includes(`/a/${doc.id}/query`)) return;
  if (r.method() === 'POST') relayCalls.push({ url: r.url(), body: r.postDataJSON() });
  if (r.method() === 'GET' && /[?&]q=/.test(r.url())) directCalls.push(r.url());
});
const resp = await p.goto(`${B}/a/${doc.id}`, { waitUntil: 'load' });
const csp = resp.headers()['content-security-policy'] ?? '';
ok(csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && !/(?:^|;)\s*sandbox(?:\s|;|$)/.test(csp), 'the reader uses the strict navigable app CSP; author execution is isolated in its child frame');
ok((await p.locator('iframe[title="artifact"]').count()) === 0, 'no iframe: the public data document IS the page');
ok(p.url() === `${B}/a/${doc.id}`, `URL unchanged, no redirect (${new URL(p.url()).pathname})`);
const frame = p.mainFrame();
const managedRealm = async host => {
  const outer = host.locator('iframe[title="Dataflow script"]');
  await outer.waitFor({ timeout: 20000 });
  const wrapper = await outer.contentFrame();
  const inner = wrapper.locator('iframe');
  await inner.waitFor({ timeout: 20000 });
  return (await inner.elementHandle()).contentFrame();
};
/*
 * PAINT FIRST moved what an author script finds at startup. The rows are no
 * longer inlined, so `mx.data.get()` is empty for the round trip it takes to
 * fetch them — a script that needs them SUBSCRIBES, which is what the document
 * above does and what /docs/llm teaches. The script still runs at the first
 * commit; only the data is late.
 */
const scriptRealm = await managedRealm(frame);
await scriptRealm.waitForFunction(() => document.getElementById('out')?.textContent?.startsWith('mx:'), null, { timeout: 20000 }).catch(() => {});
ok(/^mx:object /.test(await scriptRealm.textContent('#out').catch(() => '')), 'window.mx is defined when the managed author script runs');
await scriptRealm.waitForFunction(() => /rows=2/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
ok(/^mx:object rows=2/.test(await scriptRealm.textContent('#out').catch(() => '')), 'and its query rows reach the managed script through mx.data.subscribe');
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
ok((await scriptRealm.textContent('#out')) === 'changed:NA', 'the managed author script saw the change through mx.params.subscribe');
ok(directCalls.length === 0 && relayCalls.some(call => call.body.values?.region === 'NA'), `the scoped query POST carries the selected value (${directCalls.length} GET, ${relayCalls.length} POST)`);
await frame.selectOption('select[aria-label="Region"]', '');
await frame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$2,040', null, { timeout: 15000 }).catch(() => {});
ok((await frame.textContent('[aria-label="Live number"]')) === '$2,040', 'back to All restores the whole result');
// The trusted main runtime may call its scoped query endpoint; arbitrary author
// code runs in the managed child and cannot make these direct network calls.
const queryStatus = await frame.evaluate(async id => (await fetch(`/a/${id}/query?q=%7B%7D`)).status, doc.id);
ok(queryStatus === 200, `the trusted page can query the public document (${queryStatus})`);
const reach = await scriptRealm.evaluate(async ({ id, base }) => {
  // fetch/XHR are convenience asset-proxy wrappers. Beacon bypasses those
  // wrappers, so these violations demonstrate browser CSP, not a JS guard.
  const violations = [];
  const record = event => { if (event.effectiveDirective === 'connect-src') violations.push(event.blockedURI); };
  document.addEventListener('securitypolicyviolation', record);
  const targets = [`${base}/a/${id}/query`, `${base}/api/artifacts`, 'https://untrusted.invalid/probe'];
  for (const target of targets) { try { navigator.sendBeacon(target, '{}'); } catch {} }
  const deadline = Date.now() + 2000;
  while (violations.length < targets.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  document.removeEventListener('securitypolicyviolation', record);
  return { violations, targetCount: targets.length };
}, { id: doc.id, base: B });
const blockedOrigins = new Set(reach.violations.flatMap(uri => { try { return [new URL(uri).origin]; } catch { return []; } }));
ok(reach.violations.length >= reach.targetCount && blockedOrigins.has(new URL(B).origin) && blockedOrigins.has('https://untrusted.invalid'), `author child direct network is denied by browser connect-src (${JSON.stringify(reach.violations)})`);

// ── 4. <DataTable> past the cap, through scoped POST windows ───────────────
// A dataset can never exceed the ingest cap (MAX_ROWS_LIMIT), and the query cap
// defaults to the same number — so a result past the cap comes from the QUERY:
// a cross join of a 200-row dataset is 40,000 rows, 1,000 of which the island
// carries, and the rest are read as engine windows.
const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, region: ['EU', 'NA', 'APAC'][i % 3], revenue: (i * 7919) % 10007 }));
const big = await j(await api('/api/artifacts', { dataset: rows }));
const expectedMax = Math.max(...rows.flatMap((a) => rows.map((b_) => (a.revenue + b_.revenue) % 10007)));
const tdoc = await j(await api('/api/artifacts', { markup: `<Helmet><Query name="all" source="ref:${big.id}">{\`select a.id * 200 + b.id as id, a.region, (a.revenue + b.revenue) % 10007 as revenue from public.rows a cross join public.rows b order by 1\`}</Query></Helmet>
<div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Big table</h1>
<DataTable data="$all" height="360px" columns={[{"col":"id","title":"ID"},{"col":"region","title":"Region"},{"col":"revenue","title":"Revenue","fmt":"$,.0f","bar":true}]} /></div>` }));
ok(!!tdoc.id, 'the DataTable document published');
const pageCalls = [];
p.on('request', (r) => { if (r.url().includes(`/a/${tdoc.id}/query`)) pageCalls.push({ method: r.method(), body: r.method() === 'POST' ? r.postDataJSON() : null }); });
await p.goto(`${B}/a/${tdoc.id}`, { waitUntil: 'load' });
ok((await p.locator('iframe[title="artifact"]').count()) === 0, 'the table document is top-level too');
const f2 = p.mainFrame();
await f2.locator('[aria-label="Data grid"] tbody tr').first().waitFor({ timeout: 20000 });
await f2.waitForTimeout(600);
const domRows = await f2.$$eval('[aria-label="Data grid"] tbody tr', (trs) => trs.length);
ok(domRows > 0 && domRows < 200, `the table is virtualised (${domRows} DOM rows for 1,000 loaded)`);
ok(/1,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), `and honest about holding a sample of the result (${await f2.textContent('[aria-label="Row count"]')})`);
await f2.click('[aria-label="Sort by Revenue"]');
await f2.click('[aria-label="Sort by Revenue"]');
await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('500 of'), null, { timeout: 20000 }).catch(() => {});
const topCell = await f2.$eval('[aria-label="Data grid"] tbody tr td:nth-child(3)', (td) => td.textContent);
ok(topCell === `$${expectedMax.toLocaleString('en-US')}`, `a header click sorts the WHOLE result through the engine (desc: ${topCell} first, expected $${expectedMax.toLocaleString('en-US')})`);
await f2.click('[aria-label="Load more rows"]');
await f2.waitForFunction(() => document.querySelector('[aria-label="Row count"]')?.textContent?.startsWith('1,000 of'), null, { timeout: 20000 }).catch(() => {});
ok(/1,000 of 40,000/.test(await f2.textContent('[aria-label="Row count"]')), 'load more reads the next window');
ok(pageCalls.filter(call => call.method === 'POST' && call.body.page?.name === 'all').length >= 2 && pageCalls.every(call => call.method === 'POST'), `sort and paging use the scoped POST with engine windows (${pageCalls.length} calls)`);
ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

// ── 5. private document reader ACL with the same inline runtime ────────────
// Owner: an account that claims a token, publishes the same document PRIVATE,
// shares it with a reader. Reader: a second account. The reader's page must be
// authorized inline document and its re-runs use scoped POST with the session;
// an anonymous GET is a 404 for a private document.
const sink = await startMailSink();
const stamp = Date.now().toString(36);
const ownerCtx = await b.newContext();
const owner = await ownerCtx.newPage();
await loginViaEmail(owner, B, sink, `mxmx_test_dataflow_owner_${stamp}@example.com`);
const ownerTok = (await connectAgent(B)).token;
const claimed = await owner.evaluate(async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status, ownerTok);
ok(claimed === 200, 'the owner claimed a token');
const OH = { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' };
const pds = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ dataset: [{ region: 'EU', revenue: 10 }, { region: 'NA', revenue: 20 }] }) }));
const priv = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ markup: doc1(pds.id), visibility: 'private' }) }));
ok(priv.visibility === 'private', `a private data document published (${priv.id})`);
const readerEmail = `mxmx_test_dataflow_reader_${stamp}@example.com`;
const shared = await owner.evaluate(async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares: [{ email, role: 'viewer' }] }) })).status, [priv.id, readerEmail]);
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
ok((await reader.locator('[data-mx-inline-story]').count()) === 1, 'the admitted private document renders inline after its ACL');
const pf = await artifactDocument(reader);
await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$30', null, { timeout: 20000 }).catch(() => {});
ok((await pf.textContent('[aria-label="Live number"]').catch(() => '')) === '$30', 'the private document renders its server-run data for the reader');
await pf.selectOption('select[aria-label="Region"]', 'NA');
await pf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$20', null, { timeout: 15000 }).catch(() => {});
ok((await pf.textContent('[aria-label="Live number"]')) === '$20', 'the reader\'s re-run works through the PAGE');
ok(readerRelay.length >= 1 && readerDirect.length === 0, `…as the relay POST with the session (${readerRelay.length} relayed, ${readerDirect.length} direct)`);

// ── 5b. THE READER'S SELECTION TRAVELS IN THE LINK (F2) ─────────────────────
// `?$region=west` is parsed on the SERVER and seeded through the island's
// third dataflow field, so the control is already right at FIRST PAINT and the
// document's one paint-first run goes out WITH the selection — never a run at
// the defaults followed by a correcting second one. Then the address follows
// the reader through the runtime's URL state synchronization.
const uds = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ dataset: [{ region: 'west', revenue: 10 }, { region: 'east', revenue: 25 }] }) }));
const udocSrc = `<Helmet><title>URL values gate</title><Value name="region" type="string" />
<Query name="regions" source="ref:${uds.id}">{\`select distinct region from public.rows order by 1\`}</Query>
<Query name="sales" source="ref:${uds.id}">{\`select region, sum(revenue) revenue from public.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
</Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Regions</h1>
<select aria-label="Region" value="$region" options="$regions" />
<p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p></div>`;
const udoc = await j(await fetch(`${B}/api/artifacts`, { method: 'POST', headers: OH, body: JSON.stringify({ markup: udocSrc, visibility: 'public' }) }));
ok(!!udoc.id, `the URL-values document published (${udoc.url ?? udoc.error})`);

// (a) TOP-LEVEL: a stranger's page, no session — served the document itself.
const up = await b.newPage({ viewport: { width: 1200, height: 900 } });
const upErrors = [];
up.on('pageerror', (e) => upErrors.push(e.message));
const upQueries = [];
up.on('request', (r) => { if (r.url().includes(`/a/${udoc.id}/query`)) upQueries.push({ method: r.method(), body: r.method() === 'POST' ? r.postDataJSON() : null }); });
await up.goto(`${B}/a/${udoc.id}?$region=west`, { waitUntil: 'load' });
const uf = up.mainFrame();
await uf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent?.startsWith('$'), null, { timeout: 20000 }).catch(() => {});
ok((await uf.$eval('select[aria-label="Region"]', (el) => el.value)) === 'west', `the link's selection is what the control shows at first paint (${await uf.$eval('select[aria-label="Region"]', (el) => el.value)})`);
ok((await uf.textContent('[aria-label="Live number"]')) === '$10', 'and the numbers are the SELECTED ones, not the defaults corrected a moment later');
ok(upQueries.length === 1, `the document ran its queries ONCE, with the selection (${upQueries.length} query request(s))`);
ok(upQueries[0]?.method === 'POST' && upQueries[0]?.body.values?.region === 'west', 'and that one scoped POST carried the selection in its body');
ok(!upErrors.some((e) => /hydrat/i.test(e)), 'no hydration error: the SSR control and the hydrated store agree by construction');
// (b) the address follows the reader
await uf.selectOption('select[aria-label="Region"]', 'east');
await uf.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 15000 }).catch(() => {});
await up.waitForFunction(() => location.search.includes('east'), null, { timeout: 5000 }).catch(() => {});
ok(up.url().includes('$region=east'), `picking rewrites the address (${new URL(up.url()).search})`);
ok(!up.url().includes('west'), 'and replaces the old selection rather than appending to it');
// (c) …and the link it produced is the document it describes
await up.reload({ waitUntil: 'load' });
await up.mainFrame().waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 20000 }).catch(() => {});
ok((await up.mainFrame().$eval('select[aria-label="Region"]', (el) => el.value)) === 'east', 'a reload of the copied address is the same document');
ok((await up.mainFrame().textContent('[aria-label="Live number"]')) === '$25', '…with the same numbers');
await up.close();

// (d) The owner's inline document has the same selection/address behavior and
// must not reload when a signal changes.
let frameLoads = 0;
owner.on('domcontentloaded', () => { frameLoads++; });
await owner.goto(`${B}/a/${udoc.id}?$region=west`, { waitUntil: 'load' });
const ownerFrame = await artifactDocument(owner);
await ownerFrame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent?.startsWith('$'), null, { timeout: 20000 }).catch(() => {});
ok(ownerFrame.url().includes('$region=west'), `the owner document receives the link's selection (${new URL(ownerFrame.url()).search})`);
ok((await ownerFrame.$eval('select[aria-label="Region"]', (el) => el.value)) === 'west', 'the owner control shows it');
const loadsBefore = frameLoads;
await ownerFrame.selectOption('select[aria-label="Region"]', 'east');
await ownerFrame.waitForFunction(() => document.querySelector('[aria-label="Live number"]')?.textContent === '$25', null, { timeout: 15000 }).catch(() => {});
await owner.waitForFunction(() => location.search.includes('east'), null, { timeout: 5000 }).catch(() => {});
ok(owner.url().includes('$region=east'), `picking rewrites the page address (${new URL(owner.url()).search})`);
ok(frameLoads === loadsBefore, `…and the document was not reloaded to do it (${frameLoads - loadsBefore} frame navigation(s))`);

// (e) the EXPORT photographs the selection — and is not the cached default shot.
const shot = async (search) => Buffer.from(await (await fetch(`${B}/a/${udoc.id}/export${search}`, { headers: { Authorization: `Bearer ${ownerTok}` } })).arrayBuffer());
const shotDefault = await shot('');
const shotWest = await shot('?$region=west');
ok(shotDefault.length > 1000 && shotWest.length > 1000, `both exports rendered (${shotDefault.length} B, ${shotWest.length} B)`);
ok(!shotDefault.equals(shotWest), 'the selected export is a different picture from the default one');

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
