/**
 * Gate: LIVE DATASET CELLS — two signed-in people type into one dataset text cell at once through `@afbin/collab`, in
 * real browsers, against the real server (lib/region-sessions cells), the parent's relay (solid/document/cell-editing,
 * artifact-backend/region-http) and the frame's binding (@afbin/collab over the reader's cell port). A tracker page
 * binds its first task's `description` to a textarea; the owner (A) and a signed-in link holder (B, the dataset's
 * `signed_in` update rule) edit; a signed-out reader (C) only reads.
 *
 *   1. both open the page: the cell is `synced` for both, `readonly` (and the textarea read-only, no cell request) for
 *      the signed-out reader;
 *   2. A and B type at once and converge, and each status goes `pending` → `synced`;
 *   3. latency: A types 20 marker characters, each timed from the key to the character in B's textarea (p50/p95
 *      logged, p95 > 1000 ms fails);
 *   4. a GraphQL write of the cell (the owner's bearer, through the page) while B has unsaved typing: both open pages
 *      show the write merged with the typing, and the next save keeps both;
 *   5. both leave: the typing is saved as the cell's value through the dataset, and the signed-out reader, reloading,
 *      reads exactly it.
 *
 *   node scripts/gates/gate-live-cells.mjs [base]
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { connectAgent } from './lib/account-connection.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentFrame } from './lib/page-facts.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { sleep } from './lib/sleep.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('live-cells');
const section = createSection(check);
const started = performance.now();
const stamp = Date.now().toString(36);
const FIELD = 'textarea#description';
const ROWS = [{ title: 'Login', description: 'Fix the login bug', owner: 'ada' }, { title: 'Docs', description: 'Write the docs', owner: 'bo' }];
const POLICY = {
  version: 3,
  tables: [{
    table: { schema: 'public', name: 'rows' },
    collaborative_columns: ['description'],
    select_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: { columns: '*', filter: {} } })),
    update_permissions: [{ role: 'signed_in', permission: { columns: ['description'], filter: {} } }],
  }],
};
const page = (datasetId) => `<!doctype html><html><head><title>Tracker</title>
<link rel="af-dataset" data-af-name="tasks" href="ref:${datasetId}"></head>
<body style="padding:40px;font:18px/1.5 sans-serif"><h1>Tracker</h1>
<textarea id="description" rows="5" cols="70"></textarea><p>Status: <output id="status">loading</output></p>
<script type="module">
import {client,gql} from '@afbin/apollo';
import {collab} from '@afbin/collab';
const {data}=await client.query({query:gql\`{ tasks { _id description } }\`});
const row=data.tasks[0], field=document.getElementById('description'), status=document.getElementById('status');
field.value=row.description??'';
const text=collab.text('tasks',row._id,'description');
text.bind(field);
const show=()=>{status.textContent=text.status;field.dataset.status=text.status;};
text.on('status',show);show();
</script></body></html>`;

async function until(read, want, budgetMs = 10_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(50); } while (Date.now() < end);
  return value;
}
const valueOf = (frame) => frame.locator(FIELD).inputValue();
const statusOf = (frame) => frame.locator(FIELD).getAttribute('data-status');
const both = (frames, ...parts) => Promise.all(frames.map((frame) => until(() => valueOf(frame), (text) => parts.every((part) => text?.includes(part)), 15_000)));
const atEnd = async (frame, p) => { await frame.locator(FIELD).click(); await p.keyboard.press('ControlOrMeta+End'); };

const browser = await launchChromium();
const sink = await startMailSink();
const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1000, height: 700 } })));
const [A, B, C] = await Promise.all(contexts.map((context) => context.newPage()));
const ownerEmail = `mxmx_test_cells_owner_${stamp}@example.com`;
const writerEmail = `mxmx_test_cells_writer_${stamp}@example.com`;
const traffic = new Map([[A, []], [B, []], [C, []]]);
for (const [p, log] of traffic) p.on('request', (request) => { const url = request.url(); if (url.includes('/regions')) log.push({ at: performance.now(), method: request.method(), url }); });

let token = '', datasetId = '', pageId = '', rowId = '', frames = {};
const api = async (path, init = {}) => {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const gql = (query, variables = {}) => api(`/api/artifacts/${pageId}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables, revision: '1' }), headers: { 'idempotency-key': randomUUID().replaceAll('-', '') } });
const stored = async () => (await gql('query($id: ID!) { tasks_by_pk(_id: $id) { description } }', { id: rowId })).data?.tasks_by_pk?.description;

try {
  await section('setup: a dataset with a collaborative column, a tracker page binding it, two accounts and a reader', async () => {
    await Promise.all([loginViaEmail(A, BASE, sink, ownerEmail), loginViaEmail(B, BASE, sink, writerEmail)]);
    ({ token } = await connectAgent(BASE, { email: ownerEmail }));
    ({ id: datasetId } = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ dataset: ROWS, title: 'Tasks', access: 'readwrite', visibility: 'unlisted' }), headers: { 'idempotency-key': randomUUID() } }));
    const { revision } = await api(`/api/artifacts/${datasetId}/policy`);
    const saved = await api(`/api/artifacts/${datasetId}/policy`, { method: 'PUT', body: JSON.stringify({ policy: POLICY, expectedPolicyRevision: revision }) });
    check(saved.saved === true && /Typed live together/.test(saved.readBack), 'the owner made `description` collaborative (the read-back says so)');
    ({ id: pageId } = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ html: page(datasetId), title: 'Tracker', visibility: 'public' }), headers: { 'idempotency-key': randomUUID() } }));
    rowId = (await gql('{ tasks { _id } }')).data.tasks[0]._id;
    await Promise.all([A, B, C].map((p) => p.goto(`${BASE}/a/${pageId}`, { waitUntil: 'load' })));
    const [a, b, c] = await Promise.all([A, B, C].map((p) => documentFrame(p)));
    frames = { a, b, c };
    await Promise.all([a, b, c].map((frame) => frame.locator(FIELD).waitFor()));
  });
  const { a, b, c } = frames;

  await section('the cell opens for both writers and is read-only for the signed-out reader', async () => {
    check(await until(() => statusOf(a), (s) => s === 'synced', 15_000) === 'synced', 'the owner\'s cell is synced');
    check(await until(() => statusOf(b), (s) => s === 'synced', 15_000) === 'synced', 'the signed-in link holder\'s cell is synced');
    check(await until(() => statusOf(c), (s) => s === 'readonly') === 'readonly', 'the signed-out reader\'s cell is readonly');
    check(await c.locator(FIELD).evaluate((node) => node.readOnly) === true, 'the signed-out reader\'s textarea is read-only');
    check(await valueOf(c) === 'Fix the login bug', 'the signed-out reader reads the saved value');
  });

  await section('two people type into the cell at once and converge', async () => {
    await atEnd(a, A);
    await atEnd(b, B);
    await Promise.all([A.keyboard.type(' alpha-A', { delay: 25 }), B.keyboard.type(' bravo-B', { delay: 25 })]);
    const [atA, atB] = await both([a, b], 'alpha-A', 'bravo-B');
    check(atA?.includes('alpha-A') && atA?.includes('bravo-B'), `the owner sees both people's typing (${JSON.stringify(atA)})`);
    check(atB === atA, `the writer converges on the same text (${JSON.stringify(atB)})`);
    check(await until(() => statusOf(a), (s) => s === 'synced') === 'synced' && await until(() => statusOf(b), (s) => s === 'synced') === 'synced', 'both statuses settle on synced');
    await B.keyboard.press('Enter');
    await B.keyboard.type('second line');
    check((await both([a], '\nsecond line'))[0]?.includes('\nsecond line'), 'a newline is part of the cell');
  });

  await section('latency: 20 characters from A\'s key to B\'s textarea', async () => {
    await atEnd(a, A);
    await A.keyboard.type(' [');
    await both([b], ' [');
    const markers = 'qwertyuiopasdfghjklz';
    const samples = [];
    for (let i = 0; i < markers.length; i++) {
      const want = `[${markers.slice(0, i + 1)}`;
      const t0 = performance.now();
      await A.keyboard.type(markers[i]);
      await b.waitForFunction(({ selector, want }) => document.querySelector(selector)?.value?.includes(want), { selector: FIELD, want }, { polling: 'raf', timeout: 10_000 });
      samples.push(performance.now() - t0);
    }
    const sorted = [...samples].sort((x, y) => x - y);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    check.note(`latency over ${samples.length} keys: p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${sorted.at(-1).toFixed(0)} ms`);
    check(at(0.95) <= 1000, `key-to-peer latency p95 ${at(0.95).toFixed(0)} ms is within 1000 ms`);
  });

  await section('a GraphQL write during live typing keeps both', async () => {
    const before = await stored();
    check(before === 'Fix the login bug', `nothing typed is saved yet (${JSON.stringify(before)})`);
    await atEnd(b, B);
    await B.keyboard.type(' unsaved-B');
    await both([a, b], 'unsaved-B');
    const written = await gql('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {description: "Fix the signup bug"}) { description } }', { id: rowId });
    check(!written.errors?.length, `the owner's GraphQL write landed (${JSON.stringify(written.errors ?? [])})`);
    const [atA, atB] = await both([a, b], 'signup', 'unsaved-B', 'alpha-A');
    check(atA?.includes('signup') && !atA.includes('login') && atA.includes('unsaved-B') && atA.includes('bravo-B'), `the open pages show the write merged with everyone's typing (${JSON.stringify(atA)})`);
    check(atB === atA, 'both open pages agree');
  });

  await section('leaving saves the typing through the dataset; the reader reloads and reads it', async () => {
    const shown = await valueOf(a);
    await Promise.all([A.close({ runBeforeUnload: true }), B.close({ runBeforeUnload: true })]);
    const saved = await until(stored, (value) => value === shown, 20_000);
    check(saved === shown, `the leave saved the cell as one string (${JSON.stringify(saved)})`);
    await C.reload({ waitUntil: 'load' });
    const c2 = await documentFrame(C);
    check(await until(() => valueOf(c2), (value) => value === shown, 15_000) === shown, 'the signed-out reader reads the saved value after a reload');
    check(traffic.get(C).length === 0, `the signed-out reader made no cell request (${traffic.get(C).map((entry) => entry.url).join(' ') || 'none'})`);
    void c;
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
