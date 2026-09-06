/**
 * Gate: A WRITE BY ONE READER REACHES EVERY OTHER, LIVE.
 *
 * The claim the whole feature rests on, and the one no unit test can make:
 * three real browsers on the same data. One holds the poll and clicks Vote;
 * another holds the SAME document; a third holds a DIFFERENT document that
 * only reads the same dataset. Both watchers must show the new row without a
 * reload — and without their own state being thrown away, which is the thing
 * a reload would silently fix and a real implementation must not need.
 *
 * Checked here rather than in a unit test because every part of it is a
 * browser fact: the sandboxed document's own POST, the SSE `data` frame, the
 * store's re-run, and React keeping the DOM it already had.
 *
 *   usage: node scripts/gate-live-data.mjs [base]
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };
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

const CHART = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"votes","type":"quantitative"},"y":{"field":"choice","type":"nominal"}}}}';

const poll = (ds) =>
  '<Helmet>'
  + '<Value name="choice" type="string" default="ramen" />'
  + '<Value name="who" type="string" default="anon" />'
  + `<Query name="tally">{\`select choice, count(*)::int votes from ref_${ds} group by 1 order by 1\`}</Query>`
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice, who) values ($choice, $who)\`}</Mutation>`
  + '</Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1 id="h">Lunch</h1>'
  + '<Segmented label="Choice" value="$choice" options={["ramen","tacos","salad"]} />'
  + '<Button run="$vote">Vote</Button>'
  + `<Question title="Votes" data="$tally" height={300} viz={${CHART}} />`
  + '<DataTable data="$tally" height="200px" />'
  + '</div>';

/** A second, READ-ONLY document over the same dataset — the owner's dashboard. */
const dashboard = (ds) =>
  `<Helmet><Query name="all">{\`select count(*)::int n from ref_${ds}\`}</Query></Helmet>`
  + '<div data-design="tw" className="p-10"><h1>Total</h1>'
  + '<p>rows: <Number data="$all" col="n" agg="sum" /></p></div>';

async function publish(token, id, markup) {
  const res = await fetch(`${BASE}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ markup }),
  });
  if (!res.ok) throw new Error(`PUT ${id} → ${res.status} ${await res.text()}`);
}

// ── the data, made WRITABLE ──────────────────────────────────────────────────
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
if (!dsRes.ok) throw new Error(`dataset → ${dsRes.status} ${await dsRes.text()}`);
const ds = (await dsRes.json()).id;
ok(true, `writable dataset ${ds}`);

// The poll rides the document the start link already made; the dashboard is its own.
await publish(seed.token, seed.id, poll(ds));
const second = await startDocument(BASE);
await publish(second.token, second.id, dashboard(ds));

const browser = await chromium.launch();

// Three independent contexts — three people, no shared session.
const voterCtx = await browser.newContext();
const watcherCtx = await browser.newContext();
const dashCtx = await browser.newContext();
const voterPage = await voterCtx.newPage();
const watcher = await watcherCtx.newPage();
const dash = await dashCtx.newPage();

const votes = async (page) => page.evaluate(() => {
  const text = document.body.innerText;
  const m = /ramen\s+(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
});
const totalRows = async (page) => page.evaluate(() => {
  const m = /rows:\s*([\d,]+)/.exec(document.body.innerText);
  return m ? Number(m[1].replace(/,/g, '')) : null;
});

await becomeOwner(voterPage,BASE,seed.token);
await voterPage.goto(`${BASE}/a/${seed.id}`, {waitUntil:'load'});
await voterPage.locator('iframe[title="artifact"]').waitFor();
const voter = await (await voterPage.locator('iframe[title="artifact"]').elementHandle()).contentFrame();
await watcher.goto(`${BASE}/a/${seed.id}`, { waitUntil: 'load' });
await dash.goto(`${BASE}/a/${second.id}`, { waitUntil: 'load' });

// Everyone starts from the same server-rendered state.
const start = await until(() => votes(watcher), (v) => typeof v === 'number');
ok(start === 1, `the watcher starts at ramen=1 (got ${start})`);
const startRows = await until(() => totalRows(dash), (v) => typeof v === 'number');
ok(startRows === 1, `the dashboard starts at rows=1 (got ${startRows})`);

/*
 * Nobody reloads for the rest of this gate: a reload would hide every bug here.
 *
 * Measured by a SENTINEL on the window rather than by counting navigation
 * events. A reload is what wipes it, and only a reload — where `framenavigated`
 * also fires for a SAME-DOCUMENT history write, which a reader's `<Value>` pick
 * now makes (their choice travels in the address bar: lib/story/url-values).
 * That counted the feature as a reload and failed this line for a document that
 * had not been re-fetched at all. The sentinel is also the stricter test: it
 * catches a reload however it happened.
 */
const sentinel = async (page) => page.evaluate(() => { window.__mxNoReload = 1; });
const stillAlive = async (page) => page.evaluate(() => window.__mxNoReload === 1);
await sentinel(watcher);
await sentinel(dash);

// The WATCHER makes a choice of their own first — it must survive the write.
await watcher.getByRole('button', { name: /tacos/i }).click().catch(() => {});
await sleep(400);

// ── the vote ────────────────────────────────────────────────────────────────
await voter.getByRole('button', { name: 'Vote' }).click();

const voterAfter = await until(() => votes(voter), (v) => v === 2);
ok(voterAfter === 2, `the VOTER's own chart redraws on the click (got ${voterAfter})`);

const watcherAfter = await until(() => votes(watcher), (v) => v === 2);
ok(watcherAfter === 2, `the WATCHER sees ramen=2 without a reload (got ${watcherAfter})`);
ok(await stillAlive(watcher), 'the watcher never reloaded (its window survived the write)');

const dashAfter = await until(() => totalRows(dash), (v) => v === 2);
ok(dashAfter === 2, `a DIFFERENT document reading the same dataset redraws (rows=${dashAfter})`);
ok(await stillAlive(dash), 'the dashboard never reloaded (its window survived the write)');

// The reader's own selection is theirs, not the document's to reset.
const kept = await watcher.evaluate(() => !!document.querySelector('[aria-pressed="true"]')?.textContent?.match(/tacos/i));
ok(kept, "the watcher's own selection survived someone else's write");

// ── the toggle is the gate: close writes, and the button stops ───────────────
const shut = await fetch(`${BASE}/api/artifacts/${ds}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seed.token}` },
  body: JSON.stringify({ dataset: [{ choice: 'ramen', who: 'seed' }], access: 'read' }),
});
ok(shut.ok, 'the dataset can be closed again');
const refused = await voter.evaluate(async (id) => {
  const res = await fetch(`/a/${id}/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ mutation: 'vote', values: { choice: 'ramen' } }),
  }).catch(() => null);
  return res ? res.status : 0;
}, seed.id).catch(() => 0);
ok(refused === 403, `a write to a closed dataset is refused (${refused})`);

// ── 2. THE RELAY PATH and browser sharing control ────────────────────────────
//
// A document INSIDE a parent page is opaque-origin and cannot present a
// session, so its writes go through the page (mx:mutate → POST /a/<id>/mutate).
// That path is chosen by "am I framed", not by visibility — an OWNER viewing
// their own document gets the shell, so this exercises exactly the code a
// private document's readers use, without needing an email login.
//
// The same page proves that the normal share menu can make a dataset writable.
{
  // The dataset and the document share ONE owner: a <Mutation> may only write
  // a dataset its own publisher owns, so two anonymous tokens would (rightly)
  // be refused at publish.
  const owner = await startDocument(BASE);
  const ds2 = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({
      title: 'Relay votes',
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
  ok(rowShown, 'the writes row appears for a dataset owner');

  await Promise.all([
    page.waitForRequest((r) => r.url().includes('/sharing') && r.method() === 'PUT', { timeout: 8000 }),
    toggle.click(),
  ]);
  await until(async () => (await fetch(`${BASE}/api/artifacts/${ds2.id}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then((r) => r.json())).access, (a) => a === 'readwrite');
  const access = (await fetch(`${BASE}/api/artifacts/${ds2.id}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then((r) => r.json())).access;
  ok(access === 'readwrite', `the toggle actually opened the dataset (${access})`);

  // Only NOW can the poll publish — which is itself the proof that the toggle
  // is the gate: the same PUT would have been refused a moment ago.
  await publish(owner.token, owner.id, poll(ds2.id));

  // Now the RELAY write: the owner's own document, framed, writing through the page.
  await page.goto(`${BASE}/a/${owner.id}`, { waitUntil: 'load' });
  const frame = await until(async () => page.frame({ url: (u) => u.pathname.includes('/raw') }), (f) => !!f);
  ok(!!frame, 'the owner sees the document in a frame (the relay path)');
  const relayVotes = async () => frame.evaluate(() => {
    const m = /ramen\s+(\d+)/.exec(document.body.innerText);
    return m ? Number(m[1]) : null;
  });
  ok(await until(relayVotes, (v) => v === 1) === 1, 'the framed document renders its data');
  await frame.getByRole('button', { name: 'Vote' }).click();
  const after = await until(relayVotes, (v) => v === 2);
  ok(after === 2, `a write RELAYED through the page lands and redraws (got ${after})`);
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall ok');
process.exit(failures.length ? 1 : 0);
