/**
 * Gate: SOMEONE ELSE WRITES, AND THE PAGE YOU HAVE OPEN FOLLOWS — WITHOUT A RELOAD.
 *
 * The promise the whole product rests on, and the one no unit test can make: a write by one person or agent
 * reaches every open page, in place, and costs the reader nothing they had (their place, their mode, their own
 * choice, the chart element on screen). Every leg is a browser fact — the framed document's own POST to its door,
 * the SSE `data` frame, the store's re-run, the islands keeping the DOM they had — and every document read happens
 * inside the document's frame on its own origin (lib/page-facts). The legs are independent people, so they run
 * at once in one browser:
 *
 *   votes      three readers on the same data: one votes, one watches the same document, one holds a DIFFERENT
 *              document over the same dataset; both watchers redraw with no reload and the watcher's own pick
 *              survives; closing the dataset stops the button (formerly gate-live-data).
 *   share      the share menu makes a dataset writable, and the owner's framed document writes through its own
 *              door (formerly gate-live-data).
 *   agent      an agent rewrites a shared link: a hydrating document is morphed in place (chart element kept,
 *              never navigated, place kept); a prose one too; the reader's dark mode outlives both kinds of
 *              write (formerly gate-live-reader).
 *   watched    a reader watches an agent write, then presses edit: the editor opens on the LIVE document, not
 *              the page it was rendered with (formerly gate-inplace-edit, section 3's second half).
 *   reader     the authored theme, a bound select re-running its query live, the owner's Edit control, and one
 *              appearance choice turning both the app and the framed document (formerly gate-app-flows VIEWER).
 *
 *   usage: node scripts/gates/gate-live.mjs [base]
 */
import { documentFrame, documentLocator, inlineStory } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import { lane } from './lib/lane.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for `read()` to satisfy `want`, or give up. Returns the last value seen. */
async function until(read, want, budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    last = await read().catch(() => undefined);
    if (want(last)) return last;
    await sleep(200);
  }
  return last;
}

/** PUT a document's markup as its own connection. */
async function put(token, id, body) {
  const res = await fetch(`${BASE}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${id} → ${res.status} ${await res.text()}`);
  return res;
}

const browser = await launchChromium();

// ── votes and share: a write by one reader reaches every other ───────────────

const VOTE_CHART = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"votes","type":"quantitative"},"y":{"field":"choice","type":"nominal"}}}}';
const poll = (ds) =>
  '<Helmet>'
  + '<Value name="choice" type="string" default="ramen" />'
  + '<Value name="who" type="string" default="anon" />'
  + `<Import name="tally_data" src="ref:${ds}" /><Query name="tally">{\`select choice, cast(count(*) as integer) votes from tally_data.rows group by 1 order by 1\`}</Query>`
  + `<Import name="vote_data" src="ref:${ds}" /><Mutation name="vote">{\`insert into vote_data.rows (choice, who) values ($choice, $who)\`}</Mutation>`
  + '</Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1 id="h">Lunch</h1>'
  + '<Segmented label="Choice" value="$choice" options={["ramen","tacos","salad"]} />'
  + '<Button run="$vote">Vote</Button>'
  + `<Question title="Votes" data="$tally" height={300} viz={${VOTE_CHART}} />`
  + '<DataTable data="$tally" height="200px" />'
  + '</div>';

/** A second, READ-ONLY document over the same dataset — the owner's dashboard. */
const dashboard = (ds) =>
  `<Helmet><Import name="all_data" src="ref:${ds}" /><Query name="all">{\`select cast(count(*) as integer) n from all_data.rows\`}</Query></Helmet>`
  + '<div data-design="tw" className="p-10"><h1>Total</h1>'
  + '<p>rows: <Number data="$all" col="n" agg="sum" /></p></div>';

/* `frame` is the document's frame (lib/page-facts documentFrame), never the app page around it. */
const votes = async (frame) => frame.evaluate(() => {
  const m = /ramen\s+(\d+)/.exec(document.body.innerText);
  return m ? Number(m[1]) : null;
});
const totalRows = async (frame) => frame.evaluate(() => {
  const m = /rows:\s*([\d,]+)/.exec(document.body.innerText);
  return m ? Number(m[1].replace(/,/g, '')) : null;
});

async function votesLeg() {
  const { must, run } = lane(check, 'votes');
  await run(async () => {
    // ── the data, made WRITABLE ──
    const seed = await startDocument(BASE);
    const dsRes = await fetch(`${BASE}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seed.token}` },
      body: JSON.stringify({
        title: 'Lunch votes',
        dataset: [{ choice: 'ramen', who: 'seed' }],
        columns: [{ name: 'choice', type: 'string' }, { name: 'who', type: 'string' }],
        access: 'readwrite',
        visibility: 'unlisted',
      }),
    });
    must(dsRes.ok, `writable dataset (${dsRes.status})`);
    const ds = (await dsRes.json()).id;

    // The poll rides the document the start link already made; the dashboard is its own.
    await put(seed.token, seed.id, { markup: poll(ds) });
    const second = await startDocument(BASE);
    await put(second.token, second.id, { markup: dashboard(ds) });

    // Three independent contexts — three people, no shared session.
    const voterPage = await (await browser.newContext()).newPage();
    const watcherPage = await (await browser.newContext()).newPage();
    const dashPage = await (await browser.newContext()).newPage();
    await becomeOwner(voterPage, BASE, seed.token);
    await voterPage.goto(`${BASE}/a/${seed.id}`, { waitUntil: 'load' });
    await inlineStory(voterPage, { state: 'visible' });
    const voter = await documentFrame(voterPage);
    await watcherPage.goto(`${BASE}/a/${seed.id}`, { waitUntil: 'load' });
    await dashPage.goto(`${BASE}/a/${second.id}`, { waitUntil: 'load' });
    const watcher = await documentFrame(watcherPage);
    const dash = await documentFrame(dashPage);

    // Everyone starts from the same server-rendered state.
    const start = await until(() => votes(watcher), (v) => typeof v === 'number');
    check(start === 1, `the watcher starts at ramen=1 (got ${start})`);
    const startRows = await until(() => totalRows(dash), (v) => typeof v === 'number');
    check(startRows === 1, `the dashboard starts at rows=1 (got ${startRows})`);

    /*
     * Nobody reloads for the rest of this leg: a reload would hide every bug here.
     *
     * Measured by a SENTINEL on the window rather than by counting navigation
     * events. A reload is what wipes it, and only a reload — where `framenavigated`
     * also fires for a SAME-DOCUMENT history write, which a reader's `<Value>` pick
     * now makes (their choice travels in the address bar: lib/story/data/url-values).
     */
    const sentinel = async (frame) => frame.evaluate(() => { window.__mxNoReload = 1; });
    const stillAlive = async (frame) => frame.evaluate(() => window.__mxNoReload === 1).catch(() => false);
    await sentinel(watcher);
    await sentinel(dash);

    // The WATCHER makes a choice of their own first — it must survive the write.
    await watcher.getByRole('button', { name: /tacos/i }).click().catch(() => {});
    await sleep(400);

    // ── the vote ──
    await voter.getByRole('button', { name: 'Vote' }).click();
    const voterAfter = await until(() => votes(voter), (v) => v === 2);
    check(voterAfter === 2, `the VOTER's own chart redraws on the click (got ${voterAfter})`);
    const watcherAfter = await until(() => votes(watcher), (v) => v === 2);
    check(watcherAfter === 2, `the WATCHER sees ramen=2 without a reload (got ${watcherAfter})`);
    check(await stillAlive(watcher), 'the watcher never reloaded (its window survived the write)');
    const dashAfter = await until(() => totalRows(dash), (v) => v === 2);
    check(dashAfter === 2, `a DIFFERENT document reading the same dataset redraws (rows=${dashAfter})`);
    check(await stillAlive(dash), 'the dashboard never reloaded (its window survived the write)');

    // The reader's own selection is theirs, not the document's to reset.
    const kept = await watcher.evaluate(() => !!document.querySelector('[aria-pressed="true"]')?.textContent?.match(/tacos/i));
    check(kept, "the watcher's own selection survived someone else's write");

    // ── the toggle is the gate: close writes, and the button stops ──
    const shut = await fetch(`${BASE}/api/artifacts/${ds}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seed.token}` },
      body: JSON.stringify({ dataset: [{ choice: 'ramen', who: 'seed' }], access: 'read' }),
    });
    check(shut.ok, 'the dataset can be closed again');
    const refused = await voter.evaluate(async (id) => {
      const res = await fetch(`/a/${id}/mutate`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ mutation: 'vote', args: { choice: 'ramen' } }),
      }).catch(() => null);
      return res ? res.status : 0;
    }, seed.id).catch(() => 0);
    check(refused === 403, `a write to a closed dataset is refused (${refused})`);
    await Promise.all([voterPage, watcherPage, dashPage].map((p) => p.context().close()));
  });
}

/*
 * THE OWNER'S FRAMED WRITE and browser sharing control. The opaque-origin relay (mx:mutate through the page) is
 * gone: a document on its own origin posts to its own door with the pages session cookie
 * (lib/serving/pages-origin), owner or not. The same page proves the share menu can make a dataset writable.
 */
async function shareLeg() {
  const { run } = lane(check, 'share');
  await run(async () => {
    // The dataset and the document share ONE owner: a <Mutation> may only write
    // a dataset its own publisher owns, so two anonymous tokens would (rightly)
    // be refused at publish.
    const owner = await startDocument(BASE);
    const ds2 = await fetch(`${BASE}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({
        title: 'Relay votes',
        access: 'read',
        dataset: [{ choice: 'ramen', who: 'seed' }],
        columns: [{ name: 'choice', type: 'string' }, { name: 'who', type: 'string' }],
        visibility: 'unlisted',
      }),
    }).then((r) => r.json());

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await becomeOwner(page, BASE, owner.token);

    // The dataset is still read-only: the share menu makes it writable here.
    await page.goto(`${BASE}/a/${ds2.id}`, { waitUntil: 'load' });
    await openArtifactControls(page);
    await page.getByLabel('Share').click();
    const toggle = page.getByLabel('Make read & write');
    // The popover loads its state over the network, so WAIT rather than sampling:
    // a bare isVisible() here races the fetch and reports a false negative.
    const rowShown = await toggle.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    check(rowShown, 'the writes row appears for a dataset owner');

    await Promise.all([
      page.waitForRequest((r) => r.url().includes('/sharing') && r.method() === 'PUT', { timeout: 8000 }),
      toggle.click(),
    ]);
    const access = await until(async () => (await fetch(`${BASE}/api/artifacts/${ds2.id}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then((r) => r.json())).access, (a) => a === 'readwrite');
    check(access === 'readwrite', `the toggle actually opened the dataset (${access})`);

    // Only NOW can the poll publish — which is itself the proof that the toggle
    // is the gate: the same PUT would have been refused a moment ago.
    await put(owner.token, owner.id, { markup: poll(ds2.id) });

    // Now the owner's own document, framed on its own origin, writing through its door.
    await page.goto(`${BASE}/a/${owner.id}`, { waitUntil: 'load' });
    const frame = await documentFrame(page).catch(() => null);
    check(!!frame && frame !== page.mainFrame(), 'the owner sees the document in its frame');
    const relayVotes = async () => frame.evaluate(() => {
      const m = /ramen\s+(\d+)/.exec(document.body.innerText);
      return m ? Number(m[1]) : null;
    });
    check(await until(relayVotes, (v) => v === 1) === 1, 'the framed document renders its data');
    await frame.getByRole('button', { name: 'Vote' }).click();
    const after = await until(relayVotes, (v) => v === 2);
    check(after === 2, `the owner's write from the framed document lands and redraws (got ${after})`);
    await ctx.close();
  });
}

// ── agent: a shared link is live ─────────────────────────────────────────────
/*
 * Hand someone a link and let an agent write. Two kinds of document take different routes to the same promise:
 * one with a chart (it hydrates, so it re-renders itself in place) and one of pure prose. The compiled reader
 * draws both in place (lib/islands/live-update): the page is never navigated and a chart keeps its element. The
 * document scrolls inside its frame and holds its own live stream; every read is of the frame, re-found each
 * time: a document that reloads to take a write is a new Frame, and a held one would be detached.
 */
const READER_CHART = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}}';
const filler = Array.from({ length: 40 }, (_, i) => `<p id="f${i}">filler paragraph ${i}, long enough that this document scrolls a good way past the fold.</p>`).join('');
const withChart = (lede) =>
  '<Helmet><Value name="rows" type="table" value={[{"x":"a","y":1},{"x":"b","y":3}]} /></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + `<h1 id="h">Live</h1><p id="lede">${lede}</p>`
  + `<Question data="$rows" height={300} viz={${READER_CHART}} />${filler}</div>`;
const prose = (lede) => `<div data-design="tw" className="p-10"><h1 id="h">Prose</h1><p id="lede">${lede}</p>${filler}</div>`;

async function publishLive(markup) {
  const start = await startDocument(BASE);
  await put(start.token, start.id, { markup });
  return { ...start, write: (next) => put(start.token, start.id, { markup: next }) };
}
const docEval = async (page, fn, arg) => (await documentFrame(page, { timeout: 5000 })).evaluate(fn, arg);
/** Wait until the document's text matches `re`; true when it did. */
async function docText(page, re, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await docEval(page, () => document.body?.textContent ?? '').catch(() => '');
    if (re.test(text)) return true;
    await sleep(200);
  }
  return false;
}
const STORY = '[data-mx-inline-story]:not([data-mx-initial-story])';
const storyHas = (page, cls) => docEval(page, ([sel, c]) => !!document.querySelector(sel)?.classList.contains(c), [STORY, cls]).catch(() => false);
/** Wait (briefly) for the story element to carry `cls`: the app page's choice reaches the frame by postMessage. */
async function storyBecomes(page, cls, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await storyHas(page, cls)) return true; await sleep(150); }
  return storyHas(page, cls);
}
/** A READER: a fresh context, no session, nothing but the link. */
async function readerOf(doc, first) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  return { ctx, page, saw: await docText(page, first, 20000) };
}

/** 1. A document that hydrates: adopted in place. */
async function agentHydrates() {
  const { must, run } = lane(check, 'agent');
  await run(async () => {
    const doc = await publishLive(withChart('the first version'));
    const ctx = await browser.newContext();
    const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
    let reloads = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads++; });
    await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
    must(await docText(page, /the first version/, 20000), 'the reader saw the first version');
    await sleep(3000);

    // Where they are, and what they are looking at.
    await docEval(page, () => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
    await sleep(800);
    const before = await docEval(page, () => ({
      y: window.scrollY,
      chart: (() => { const el = document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas'); if (el) el.__probe = 'keep'; return !!el; })(),
    }));
    const loadsBefore = reloads;

    await doc.write(withChart('THE AGENT REWROTE THIS'));
    await docText(page, /THE AGENT REWROTE THIS/, 25000);
    await sleep(1500);
    const after = await docEval(page, () => ({
      text: document.body.textContent ?? '',
      y: window.scrollY,
      chartKept: document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas')?.__probe ?? null,
    }));
    check(/THE AGENT REWROTE THIS/.test(after.text), "the reader sees the agent's write, with no reload of their own");
    // The compiled reader draws the new version in place: the page by morphing its
    // served story into the new version's (lib/islands/live-update), an unchanged island left running.
    check(reloads === loadsBefore, `and the page was never navigated to do it (${reloads - loadsBefore})`);
    check(before.chart && after.chartKept === 'keep', 'the chart kept its rendered element through the update');
    check(Math.abs(after.y - before.y) < 60, `and the reader kept their place (${before.y} → ${after.y})`);
    await ctx.close();
  });
}

/** 2. A document that hydrates nothing: place kept. */
async function agentProse() {
  const { must, run } = lane(check, 'agent prose');
  await run(async () => {
    const doc = await publishLive(prose('the first version'));
    const { ctx, page, saw } = await readerOf(doc, /the first version/);
    must(saw, 'the prose reader saw the first version');
    await sleep(2000);
    await docEval(page, () => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45)));
    await sleep(800);
    const before = await docEval(page, () => window.scrollY);
    await doc.write(prose('THE AGENT REWROTE THIS TOO'));
    await docText(page, /THE AGENT REWROTE THIS TOO/, 25000);
    await sleep(2500);
    const after = await docEval(page, () => ({ text: document.body.textContent ?? '', y: window.scrollY }));
    check(/THE AGENT REWROTE THIS TOO/.test(after.text), 'a prose document reaches its reader too');
    check(Math.abs(after.y - before) < 120, `and the reload kept their place (${before} → ${after.y})`);
    await ctx.close();
  });
}

/** 3. The reader's mode override outlives the author's writes. */
async function agentMode() {
  const { must, run } = lane(check, 'agent mode');
  await run(async () => {
    const doc = await publishLive(withChart('mode probe'));
    const { ctx, page, saw } = await readerOf(doc, /mode probe/);
    must(saw, 'the reader saw the mode probe');
    await sleep(2500);
    check(await storyHas(page, 'light'), 'an unthemed document opens in the author default (light)');
    // The app page's bar is always on screen (solid/document/DocumentChrome): nothing to reveal first.
    await openArtifactControls(page);
    await page.getByLabel('Dark mode', { exact: true }).click();
    check(await storyBecomes(page, 'dark'), 'the top-right toggle flips the document dark');
    await doc.write(withChart('MODE WRITE LANDED'));
    await docText(page, /MODE WRITE LANDED/, 25000);
    await sleep(1200);
    check(await storyHas(page, 'dark'), "an agent write updates the document but does not stomp the reader's mode");
    await ctx.close();
  });
}

/** 4. …and survives the reload a no-runtime document delivers edits by. */
async function agentProseMode() {
  const { must, run } = lane(check, 'agent prose mode');
  await run(async () => {
    const doc = await publishLive(prose('mode prose probe'));
    const { ctx, page, saw } = await readerOf(doc, /mode prose probe/);
    must(saw, 'the reader saw the prose mode probe');
    await sleep(2000);
    await openArtifactControls(page);
    await page.getByLabel('Dark mode', { exact: true }).click();
    await storyBecomes(page, 'dark');
    await doc.write(prose('MODE PROSE REWRITTEN'));
    await docText(page, /MODE PROSE REWRITTEN/, 25000);
    await sleep(2000);
    check(await storyHas(page, 'dark'), "a no-runtime document's reload carries the reader's mode in window.name");
    await ctx.close();
  });
}
// gate-live-reader's fifth leg ("an unknown document's stream is the uniform 404") was an HTTP fact with no browser
// in it: live-events.test.ts "404s an unknown or malformed id, indistinguishably" asserts it on the route.

// ── watched: the editor opens on what the reader is LOOKING AT ───────────────
/*
 * A reader can watch an agent write for minutes before pressing edit, so the editor has to open on the live
 * document rather than on the markup the page was server-rendered with.
 */
async function watchedLeg() {
  const { run } = lane(check, 'watched');
  await run(async () => {
    const start = await startDocument(BASE);
    const api = async (path, init) => fetch(`${BASE}/api/artifacts/${start.id}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${start.token}`, ...(init?.headers ?? {}) },
    });
    await put(start.token, start.id, { markup: '<div className="p-8"><h1>Concurrent edit</h1><p>First paragraph.</p><p>Second paragraph.</p></div>' });
    const read = async () => (await api('', {})).json();
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await becomeOwner(viewer, BASE, start.token);
    await viewer.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
    await sleep(2500);
    const watched = await read();
    await api('/edits', {
      method: 'POST',
      // Append, so the later check can still anchor on the original text.
      body: JSON.stringify({
        edit_id: watched.edit_id,
        old_string: 'Second paragraph.',
        new_string: 'Second paragraph. Written while watching.',
      }),
    });
    await sleep(3000);
    check(/Written while watching/.test(await documentLocator(viewer).locator('body').innerText()),
      'the viewer saw the live edit');
    // Reading is chromeless until the artifact controls are opened.
    await openArtifactControls(viewer);
    await viewer.click('[aria-label="Edit artifact"]');
    await sleep(4000);
    check(/Written while watching/.test(await documentLocator(viewer).locator('body').innerText()),
      'the editor opens on the LIVE document, not the page it was rendered with');
    const headNow = await read();
    check(headNow.version >= 2, `the document is on a real, advanced version (v${headNow.version})`);
    await ctx.close();
  });
}

// ── reader: theme, bound select, appearance ──────────────────────────────────
async function readerLeg() {
  const { must, run } = lane(check, 'reader');
  await run(async () => {
    const { token } = await connectAgent(BASE);
    const J = async (path, init = {}) => {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
      let body = null; try { body = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, body };
    };
    const dataset = [{ region: 'EU', month: '2026-01-01', revenue: 100 }, { region: 'NA', month: '2026-01-01', revenue: 300 }, { region: 'EU', month: '2026-02-01', revenue: 150 }, { region: 'NA', month: '2026-02-01', revenue: 250 }];
    const ds = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate data', dataset }) })).body;
    must(ds?.id, 'the gate dataset is published');
    const dataDoc = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate doc', theme: 'modernist', markup: `<Helmet>
<Value name="region" type="string" />
<Import name="regions_data" src="ref:${ds.id}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>
<Import name="sales_data" src="ref:${ds.id}" /><Query name="sales">{\`select * from sales_data.rows where $region is null or region = $region\`}</Query>
</Helmet><div data-design="tw" className="@container p-10">
<h1 className="text-4xl font-bold tracking-tight">Gate doc</h1>
<div className="mt-4"><select aria-label="Region" value="$region" options="$regions" /></div>
<p className="mt-4">Total: <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<div className="mt-6 h-64 flex min-h-0 flex-col"><Question title="Rev" data="$sales" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{x:{field:"month",type:"temporal"}, y:{field:"revenue",type:"quantitative"}}}}} /></div>
</div>` }) })).body;
    must(dataDoc?.id, 'the gate document is published');

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage();
    // A browser's credential is the httpOnly session cookie, not a localStorage token — and the shell belongs to
    // the OWNER, the connection holding `token`.
    await becomeOwner(p, BASE, token);
    await p.goto(`${BASE}/a/${dataDoc.id}`, { waitUntil: 'load' });
    await p.waitForTimeout(3500);
    const surface = await documentFrame(p);

    // The document is served on its own origin in the page's frame, so everything a
    // reader sees is asserted inside that frame — the theme included.
    const theme = await surface.locator(STORY).getAttribute('data-theme').catch(() => null);
    check(theme === 'modernist', 'the served document carries the authored theme');
    const before = (await surface.getByText('Total:').first().textContent()).trim();
    await surface.locator('select').first().selectOption('EU');
    // Wait for the CHANGE, not a fixed time: the relay's first hop pays for the
    // query route's cold start, which lands just past a 2.5 s wait.
    let after = before;
    for (let i = 0; i < 32 && after === before; i++) { await p.waitForTimeout(250); after = (await surface.getByText('Total:').first().textContent()).trim(); }
    check(before !== after, 'a bound select re-runs the query and the live Number follows');
    check((await surface.locator('svg.marks, canvas').count()) > 0, 'chart renders');
    await openArtifactControls(p);
    check((await p.locator('[aria-label="Edit artifact"]').count()) === 1, 'artifact controls offer Edit to the owner');
    // LIGHT is the app's default and carries NO attribute (app/globals.css puts
    // it on bare `:root`), so DARK is the one that gets stamped.
    await p.click('[aria-label="Light mode"]'); // the app page's control; the frame hears it over the bridge
    const light = await p.waitForFunction(() => !document.documentElement.dataset.theme, null, { timeout: 8000 })
      .then(() => surface.locator(`${STORY}.light`).waitFor({ timeout: 8000 })).then(() => true, () => false);
    check(light, 'one appearance choice turns both the app and document light');
    await p.click('[aria-label="Dark mode"]');
    const dark = await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 8000 })
      .then(() => surface.locator(`${STORY}.dark`).waitFor({ timeout: 8000 })).then(() => true, () => false);
    check(dark, 'the same appearance choice turns both the app and document dark');
    await ctx.close();
  });
}

const started = Date.now();
// The share leg runs alone first: alongside the reader and watched legs its owner's guest session read as `anon` on
// the dataset page (/api/page/session) and the Share control never appeared — reproduced on a host server and in
// the gate container, cause not yet established; the original sequential gate never met it.
await shareLeg();
await Promise.all([votesLeg(), agentHydrates(), agentProse(), agentMode(), agentProseMode(), watchedLeg(), readerLeg()]);
check.note(`eight legs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await browser.close();
check.done();
