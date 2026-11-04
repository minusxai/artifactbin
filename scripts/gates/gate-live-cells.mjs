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
 *      reads exactly it;
 *   6. typing before the session arrives (a slowed open) is kept and merged in, not lost or doubled;
 *   7. a downloaded copy opened from disk with no network loads the library and shows the field read-only.
 *
 *   node scripts/gates/gate-live-cells.mjs [base]
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
<textarea id="description" rows="5" cols="70">Offline default</textarea><p>Status: <output id="status">loading</output></p>
<script type="module">
import {client,gql} from '@afbin/apollo';
import {collab} from '@afbin/collab';
// Offline (a downloaded copy) the read fails and the field keeps its default; the cell is read-only there.
let row=null;try{row=(await client.query({query:gql\`{ tasks { _id description } }\`})).data.tasks[0];}catch{}
const field=document.getElementById('description'), status=document.getElementById('status');
if(row)field.value=row.description??'';
const text=collab.text('tasks',row?._id??'r_offline','description');
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

  await section('typing before the session arrives is kept and merged in', async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const D = await context.newPage();
    await loginViaEmail(D, BASE, sink, writerEmail);
    // The cell's open is held back, so the first keys land before any session.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await D.route(/\/regions\/cell[^/]*\/open$/, async (route) => { await held; await route.continue(); });
    await D.goto(`${BASE}/a/${pageId}`, { waitUntil: 'load' });
    const d = await documentFrame(D);
    await until(() => valueOf(d), (value) => !!value && value !== 'Offline default', 15_000);
    const before = await valueOf(d);
    await atEnd(d, D);
    await D.keyboard.type(' early-D');
    check(await statusOf(d) === 'offline', 'the field takes keys before its session (status offline)');
    release();
    check(await until(() => statusOf(d), (s) => s === 'synced', 15_000) === 'synced', 'the session arrives and the early keys are stored');
    const saved = await until(stored, (value) => value?.endsWith(' early-D'), 20_000);
    await D.close();
    await until(stored, (value) => value === `${before} early-D`, 20_000);
    check(await stored() === `${before} early-D`, `the early keys were kept once, at the end (${JSON.stringify(saved?.slice(-40))})`);
    await context.close();
  });

  await section('a downloaded copy works offline: the library loads and the field is read-only', async () => {
    const response = await fetch(`${BASE}/a/${pageId}/download`, { headers: { authorization: `Bearer ${token}` } });
    check(response.ok, `the page downloads (${response.status})`);
    const html = await response.text();
    check(html.includes('data-af="collab"'), 'the download carries the cell library');
    const file = path.join(os.tmpdir(), `live-cells-${stamp}.html`);
    writeFileSync(file, html);
    const context = await browser.newContext({ offline: true });
    const O = await context.newPage();
    const errors = [], remote = [];
    O.on('pageerror', (error) => errors.push(error.message));
    O.on('request', (request) => { if (!/^(?:file|blob|data):/.test(request.url())) remote.push(request.url()); });
    await O.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    check(await until(() => O.locator(FIELD).getAttribute('data-status'), (s) => s === 'readonly', 15_000) === 'readonly', 'the offline copy says readonly');
    check(await O.locator(FIELD).evaluate((node) => node.readOnly) === true, 'its field is not editable');
    check(await O.locator(FIELD).inputValue() === 'Offline default', 'its field keeps the value the page gave it');
    check(errors.length === 0, `no script error offline (${errors.join(' | ') || 'none'})`);
    check(remote.length === 0, `no network request (${remote.join(' ') || 'none'})`);
    await context.close();
    rmSync(file, { force: true });
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
