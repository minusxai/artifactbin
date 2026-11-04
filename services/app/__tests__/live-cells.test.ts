/**
 * LIVE DATASET TEXT CELLS through the region doors (contract region-sessions CellScope; lib/region-sessions cells):
 * who may open a cell (the policy matrix), open, update and stream between two signed-in people, the save written
 * through the dataset's mutate path as one dataset version, a GraphQL write during live typing merged three-way so
 * both survive, a deleted row closing its cell, and the stream's saves when a reader leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { cellKey, type Actor } from '@artifactbin/contracts';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import { cellValue, openRegionDoc } from '@/lib/live-regions';
import { createRegionSessions } from '@/lib/region-sessions';
import { locateDatasetCell, writeDatasetCells } from '@/lib/dataset-graphql';
import { getDb, runWithRequest } from '@/lib/platform';
import { attachActor } from '@artifactbin/utils';
import { POST as publishRoute } from '@/app/api/artifacts/route';
import { GET as graphqlSchema } from '@/app/api/artifacts/[id]/graphql/route';
import { POST as openRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/open/route';
import { POST as updatesRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/updates/route';
import { POST as flushRoute } from '@/app/api/artifacts/[id]/regions/flush/route';
import { GET as streamRoute } from '@/app/api/artifacts/[id]/regions/stream/route';
import { regionSessions } from '@/app/api/artifacts/[id]/regions/doors';
import { patchMetadata } from './conditional-request';
import { nativeDatasetClient } from './native-dataset-http';
import { mintAccountToken, request, useAppHarness } from './harness';
import { sseStream } from './sse';

useAppHarness();

/**
 * A seam in a save: `beforeWrite` runs once, in the window between a save reading its cells and its dataset write
 * (no transaction open there), so a test can type or write the dataset while the save is in flight.
 */
const seam = vi.hoisted(() => ({ beforeWrite: null as null | (() => Promise<void>) }));
vi.mock('@/lib/dataset-graphql', async (original) => {
  const actual = await original<typeof import('@/lib/dataset-graphql')>();
  return {
    ...actual,
    writeDatasetCells: async (...args: Parameters<typeof actual.writeDatasetCells>) => {
      const hook = seam.beforeWrite;
      seam.beforeWrite = null;
      await hook?.();
      return actual.writeDatasetCells(...args);
    },
  };
});

type Person = { id: string; email: string };
const ROLES = ['viewer', 'signed_in', 'anonymous'] as const;
const ROWS = [
  { title: 'Login', description: 'Fix the login bug', notes: 'n1', team: 'red' },
  { title: 'Docs', description: 'Write the docs', notes: 'n2', team: 'blue' },
];
/** description and notes are collaborative; viewer and signed_in may change description (and title) on red rows only. */
const POLICY = (collaborative: string[] = ['description', 'notes']) => ({
  version: 3,
  tables: [{
    table: { schema: 'public', name: 'rows' },
    collaborative_columns: collaborative,
    select_permissions: ROLES.map((role) => ({ role, permission: { columns: '*', filter: {} } })),
    update_permissions: [
      { role: 'viewer', permission: { columns: ['description'], filter: { team: { _eq: 'red' } } } },
      { role: 'signed_in', permission: { columns: ['description', 'title'], filter: { team: { _eq: 'red' } } } },
      { role: 'anonymous', permission: { columns: '*', filter: {} } },
    ],
  }],
});

let owner: Person, ownerToken: string, editor: Person, viewer: Person, reader: Person;
let datasetId: string, pageId: string, red: string, blue: string;
let client: ReturnType<typeof nativeDatasetClient>;
const streams: { close(): void }[] = [];

const as = (person: Person): Actor => ({ credential: 'session', userId: person.id, email: person.email, emailVerified: true });
const call = <T>(req: Request, run: () => Promise<T>) => runWithRequest(req, run);
const key = (rowId: string, column = 'description', dataset = 'tasks') => cellKey({ dataset, rowId, column });

async function open(person: Person | null, regionId: string, id = pageId) {
  const req = request(`/api/artifacts/${id}/regions/${encodeURIComponent(regionId)}/open`, { method: 'POST', origin: 'same', ...(person ? { actor: as(person) } : {}) });
  return call(req, () => openRoute(req, { params: Promise.resolve({ id, regionId }) }));
}
async function send(person: Person, regionId: string, body: unknown) {
  const req = request(`/api/artifacts/${pageId}/regions/${encodeURIComponent(regionId)}/updates`, { method: 'POST', json: body, origin: 'same', actor: as(person) });
  return call(req, () => updatesRoute(req, { params: Promise.resolve({ id: pageId, regionId }) }));
}
async function flushCells(person: Person) {
  const req = request(`/api/artifacts/${pageId}/regions/flush?scope=cells`, { method: 'POST', origin: 'same', actor: as(person) });
  return call(req, () => flushRoute(req, { params: Promise.resolve({ id: pageId }) }));
}
async function stream(person: Person, after: string) {
  const abort = new AbortController();
  const unsigned = request(`/api/artifacts/${pageId}/regions/stream?after=${encodeURIComponent(after)}`, {});
  const req = attachActor(new Request(unsigned, { signal: abort.signal }), as(person));
  const response = await call(req, () => streamRoute(req, { params: Promise.resolve({ id: pageId }) }));
  if (response.status !== 200) return { response, frames: null, close: () => {} };
  const frames = sseStream(response.body!);
  const handle = { close: () => { abort.abort(); frames.close(); } };
  streams.push(handle);
  return { response, frames, close: handle.close };
}
async function framesUntil(frames: ReturnType<typeof sseStream>, done: (frame: Record<string, unknown>) => boolean, budgetMs = 4000) {
  const seen: Record<string, unknown>[] = [];
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const [event] = await frames.next(1, deadline - Date.now());
    if (!event) break;
    if (event.event !== 'message') continue;
    seen.push(event.data);
    if (done(event.data)) return seen;
  }
  throw new Error(`no matching frame in ${JSON.stringify(seen).slice(0, 2000)}`);
}

/** A person's replica of a cell: the server's bytes, written under the client id the open issued. */
async function join(person: Person, regionId = key(red)) {
  const response = await open(person, regionId);
  expect(response.status, await response.clone().text()).toBe(200);
  const reply = await response.json() as { clientId: number; seq: number; state: string; kind: string; regionId: string; savedVersion: number };
  const doc = openRegionDoc(Buffer.from(reply.state, 'base64'), { clientId: reply.clientId });
  const pending: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') pending.push(update); });
  const text = doc.getText('region');
  return {
    reply, doc, text, value: () => cellValue(doc),
    async push() {
      const response = await send(person, regionId, { clientId: reply.clientId, update: Buffer.from(Y.mergeUpdates(pending.splice(0))).toString('base64') });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    },
    receive(updates: string[]) { for (const update of updates) Y.applyUpdate(doc, Buffer.from(update, 'base64'), 'server'); },
  };
}

const stored = async () => loadDatasetRows((await getArtifactById(datasetId))!) as Promise<typeof ROWS>;
const datasetVersion = async () => (await getArtifactById(datasetId))!.version;
const gqlAsOwner = (query: string, variables: Record<string, unknown> = {}) => client.gql(query, variables, { token: ownerToken });

beforeEach(async () => {
  const person = async (name: string) => { const user = await createUser({ email: `mxmx_test_cells_${name}@example.com` }); return { id: user.id, email: user.email! }; };
  const token = await mintAccountToken('cells_owner');
  owner = { id: token.userId!, email: token.email! };
  ownerToken = token.token;
  [editor, viewer, reader] = await Promise.all(['editor', 'viewer', 'reader'].map(person));
  const publish = async (body: object) => {
    const response = await publishRoute(request('/api/artifacts', { method: 'POST', token: ownerToken, json: body }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).id as string;
  };
  datasetId = await publish({ dataset: ROWS, title: 'Tasks', access: 'readwrite', visibility: 'unlisted' });
  pageId = await publish({ visibility: 'public', html: `<!doctype html><html><head><link rel="af-dataset" data-af-name="tasks" href="ref:${datasetId}" data-af-mode="live"><link rel="af-dataset" data-af-name="pinned" href="ref:${datasetId}" data-af-mode="pinned" data-af-revision="1"></head><body><h1>Tracker</h1></body></html>` });
  const db = await getDb();
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) await db.query('INSERT INTO artifact_shares (artifact_id, user_id, email, role) VALUES ($1, $2, $3, $4)', [datasetId, who.id, who.email, role]);
  const head = (await getArtifactById(datasetId))!;
  const saved = await patchMetadata(ownerToken, datasetId, { policy: POLICY(), expectedPolicyRevision: head.policy_revision ?? 0 });
  expect(saved.status, await saved.clone().text()).toBe(200);
  client = nativeDatasetClient(pageId);
  const read = await gqlAsOwner('{ tasks { _id team } }');
  expect(read.body.errors).toBeUndefined();
  const ids = Object.fromEntries((read.body.data!.tasks as { _id: string; team: string }[]).map((row) => [row.team, row._id]));
  red = ids.red!; blue = ids.blue!;
});
afterEach(async () => {
  seam.beforeWrite = null;
  for (const handle of streams.splice(0)) handle.close();
  await regionSessions().settle();
  regionSessions().dispose();
});

describe('who may open a cell', () => {
  it('follows the dataset role and the update rule for that row and column, on collaborative columns only', async () => {
    type Who = 'owner' | 'editor' | 'viewer' | 'signed_in' | 'anonymous';
    const people: Record<Who, Person | null> = { owner, editor, viewer, signed_in: reader, anonymous: null };
    // [who, row, column] → may open. notes is collaborative but no rule role may change it; title is not collaborative.
    const allowed = (who: Who, row: 'red' | 'blue', column: 'description' | 'notes' | 'title') => {
      if (column === 'title' || who === 'anonymous') return false;
      if (who === 'owner' || who === 'editor') return true;
      return column === 'description' && row === 'red';
    };
    const seen: string[] = [], expected: string[] = [];
    for (const who of Object.keys(people) as Who[]) for (const row of ['red', 'blue'] as const) for (const column of ['description', 'notes', 'title'] as const) {
      const response = await open(people[who], key(row === 'red' ? red : blue, column));
      seen.push(`${who} ${row} ${column} ${response.status}`);
      expected.push(`${who} ${row} ${column} ${allowed(who, row, column) ? 200 : 404}`);
    }
    expect(seen).toEqual(expected);
  });

  it('refuses a pinned link, an unknown link, row or field, and a column the owner has not made collaborative', async () => {
    for (const regionId of [key(red, 'description', 'pinned'), key(red, 'description', 'other'), key('r_nosuchrow'), key(red, 'nosuch')]) expect((await open(owner, regionId)).status, regionId).toBe(404);
    const head = (await getArtifactById(datasetId))!;
    expect((await patchMetadata(ownerToken, datasetId, { policy: POLICY(['notes']), expectedPolicyRevision: head.policy_revision ?? 0 })).status).toBe(200);
    expect((await open(owner, key(red))).status).toBe(404);
    expect((await open(owner, key(red, 'notes'))).status).toBe(200);
  });

  it('gives signed_in nothing on a private dataset (its rules never apply there)', async () => {
    expect((await open(reader, key(red))).status).toBe(200);
    await (await getDb()).query("UPDATE artifacts SET visibility = 'private' WHERE id = $1", [datasetId]);
    expect((await open(reader, key(red))).status).toBe(404);
    expect((await open(viewer, key(red))).status).toBe(200);
  });

  it('refuses updates from someone who lost the rule, and a client id another person was issued', async () => {
    const a = await join(viewer);
    a.text.insert(0, '!');
    const stolen = await send(reader, key(red), { clientId: a.reply.clientId, update: 'AAA=' });
    expect(stolen.status).toBe(422);
    await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id = $1 AND user_id = $2', [datasetId, viewer.id]);
    // Without the share the viewer is signed_in, whose rule still admits this cell: revoke the rule too.
    const head = (await getArtifactById(datasetId))!;
    const narrowed = POLICY();
    narrowed.tables[0]!.update_permissions = narrowed.tables[0]!.update_permissions.filter((entry) => entry.role !== 'signed_in');
    expect((await patchMetadata(ownerToken, datasetId, { policy: narrowed, expectedPolicyRevision: head.policy_revision ?? 0 })).status).toBe(200);
    expect((await a.push()).status).toBe(404);
  });
});

describe('typing together', () => {
  it('relays validated updates between two people and converges', async () => {
    const a = await join(viewer), b = await join(editor);
    expect(a.value()).toBe('Fix the login bug');
    const watching = await stream(viewer, `${key(red)}:${a.reply.seq}`);
    expect(watching.response.status).toBe(200);
    b.text.insert(b.text.length, ' today');
    expect((await b.push()).status).toBe(200);
    a.text.insert(0, 'Please: ');
    expect((await a.push()).status).toBe(200);
    const frames = await framesUntil(watching.frames!, (frame) => frame.type === 'updates' && JSON.stringify(frame).length > 0 && (frame.to as number) >= a.reply.seq + 3);
    for (const frame of frames) if (frame.type === 'updates') a.receive(frame.updates as string[]);
    const bStream = await stream(editor, `${key(red)}:${b.reply.seq}`);
    const bFrames = await framesUntil(bStream.frames!, (frame) => frame.type === 'updates' && (frame.to as number) >= a.reply.seq + 3);
    for (const frame of bFrames) if (frame.type === 'updates') b.receive(frame.updates as string[]);
    expect(a.value()).toBe('Please: Fix the login bug today');
    expect(b.value()).toBe(a.value());
    // A format is not plain text: refused.
    a.text.format(0, 3, { bold: true });
    expect((await a.push()).status).toBe(422);
  });

  it('a stream of cells needs no page edit access, and never mixes regions', async () => {
    const a = await join(reader);
    expect((await stream(reader, `${key(red)}:${a.reply.seq}`)).response.status).toBe(200);
    expect((await stream(reader, `${key(red)}:0,af-1:0`)).response.status).toBe(400);
    expect((await stream(reader, `${key(blue)}:0`)).response.status).toBe(200);
  });
});

describe('saving through the dataset', () => {
  it('writes the merged string through the mutate path as exactly one dataset version', async () => {
    const a = await join(viewer), b = await join(reader);
    a.text.insert(a.text.length, '\non mobile');
    await a.push();
    b.text.insert(0, 'Urgent: ');
    await b.push();
    const before = await datasetVersion();
    const saved = await flushCells(editor);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ saved: 1 });
    expect(await datasetVersion()).toBe(before + 1);
    const merged = (await stored())[0]!.description;
    expect(merged).toContain('Urgent: ');
    expect(merged).toContain('\non mobile');
    expect(merged.replace('Urgent: ', '')).toBe('Fix the login bug\non mobile');
    // Readers see it through GraphQL as a plain string, and the row keeps its _id.
    const read = await gqlAsOwner('query($id: ID!) { tasks_by_pk(_id: $id) { _id description } }', { id: red });
    expect(read.body.data!.tasks_by_pk).toEqual({ _id: red, description: merged });
    // Nothing left to save: no new version.
    expect(await (await flushCells(editor)).json()).toEqual({ saved: 0 });
    expect(await datasetVersion()).toBe(before + 1);
  });

  it('saves only what the caller may write: a viewer cannot save the blue row someone else typed in', async () => {
    const owners = await join(owner, key(blue));
    owners.text.insert(0, 'Owner: ');
    await owners.push();
    const before = await datasetVersion();
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 0 });
    expect(await datasetVersion()).toBe(before);
    expect(await (await flushCells(owner)).json()).toEqual({ saved: 1 });
    expect((await stored())[1]!.description).toBe('Owner: Write the docs');
  });

  it('merges a GraphQL update made during live typing three-way, so both survive', async () => {
    const a = await join(viewer);
    const watching = await stream(viewer, `${key(red)}:${a.reply.seq}`);
    a.text.insert(a.text.length, ' on mobile');
    const pushed = await a.push();
    expect(pushed.status).toBe(200);
    // The owner rewrites a word through the page's generated API, from the stored value.
    const written = await gqlAsOwner('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {description: "Fix the signup bug"}) { description } }', { id: red });
    expect(written.body.errors).toBeUndefined();
    expect((await stored())[0]!.description).toBe('Fix the signup bug');
    // The live cell takes the write merged in (one update attributed to nobody), streamed to the typist.
    const frames = await framesUntil(watching.frames!, (frame) => frame.type === 'updates' && (frame.to as number) > (pushed.body.seq as number));
    for (const frame of frames) if (frame.type === 'updates') a.receive(frame.updates as string[]);
    expect(a.value()).toBe('Fix the signup bug on mobile');
    // The next save writes both.
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 1 });
    expect((await stored())[0]!.description).toBe('Fix the signup bug on mobile');
  });

  it('a write landing between the merge and the save is merged in and the save tried again', async () => {
    const a = await join(viewer);
    a.text.insert(0, 'A: ');
    await a.push();
    // Another column of the same row changes (the dataset moves under the cell, its value does not).
    await gqlAsOwner('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {title: "Login 2"}) { title } }', { id: red });
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 1 });
    expect((await stored())[0]).toMatchObject({ title: 'Login 2', description: 'A: Fix the login bug' });
  });

  const dirtyCells = async () => (await (await getDb()).query<{ region_id: string }>("SELECT region_id FROM region_states WHERE artifact_id = $1 AND region_id LIKE 'cell:%' AND dirty_since IS NOT NULL", [datasetId])).rows;

  it('a cell typed in another process while the save is retried is saved by that save, in the same version', async () => {
    const a = await join(viewer);
    a.text.insert(0, 'A: ');
    expect((await a.push()).status).toBe(200);
    const other = createRegionSessions({ db: getDb, keepaliveFrame: () => ': keepalive\n\n', subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost) });
    try {
      seam.beforeWrite = async () => {
        // A write lands first (the save must retry) and, in the other process, someone types in a cell nobody had touched.
        await gqlAsOwner('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {title: "Login 2"}) { title } }', { id: red });
        const actor = identityForUser(editor.id, null, editor.email) as AccessActor;
        const opened = await other.cells.open(actor, pageId, key(blue));
        if (opened.status !== 200) throw new Error(`open ${opened.status}`);
        const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { gc: true, clientId: opened.body.clientId });
        const before = Y.encodeStateVector(doc);
        doc.getText('region').insert(0, 'B: ');
        expect((await other.cells.update(actor, pageId, key(blue), { clientId: opened.body.clientId, update: Y.encodeStateAsUpdate(doc, before) })).status).toBe(200);
      };
      const before = await datasetVersion();
      expect(await (await flushCells(editor)).json()).toEqual({ saved: 1 });
      expect(seam.beforeWrite).toBeNull();
      expect(await datasetVersion()).toBe(before + 2);
      expect((await stored()).map((row) => [row.title, row.description])).toEqual([['Login 2', 'A: Fix the login bug'], ['Docs', 'B: Write the docs']]);
      expect(await dirtyCells()).toEqual([]);
    } finally { await other.settle(); other.dispose(); }
  });

  it('typing that lands while the save writes is saved as soon as that write completes', async () => {
    const a = await join(viewer);
    a.text.insert(0, 'A: ');
    expect((await a.push()).status).toBe(200);
    seam.beforeWrite = async () => {
      a.text.insert(a.text.length, ' and more');
      expect((await a.push()).status).toBe(200);
    };
    const before = await datasetVersion();
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 2 });
    expect(await datasetVersion()).toBe(before + 2);
    expect((await stored())[0]!.description).toBe('A: Fix the login bug and more');
    expect(await dirtyCells()).toEqual([]);
    // Nothing left: the next save makes no version.
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 0 });
  });

  it('a deleted row closes its cell (closed: removed) and deletes its rows', async () => {
    const a = await join(editor);
    const watching = await stream(editor, `${key(red)}:${a.reply.seq}`);
    const deleted = await gqlAsOwner('mutation($id: ID!) { delete_tasks_by_pk(_id: $id) { _id } }', { id: red });
    expect(deleted.body.errors).toBeUndefined();
    const frames = await framesUntil(watching.frames!, (frame) => frame.type === 'closed');
    expect(frames.at(-1)).toEqual({ type: 'closed', regionId: key(red), reason: 'removed' });
    expect((await (await getDb()).query("SELECT 1 FROM region_states WHERE artifact_id = $1 AND region_id LIKE 'cell:%'", [datasetId])).rows).toEqual([]);
    expect((await open(editor, key(red))).status).toBe(404);
  });

  it('losing the rule closes a following stream (closed: access)', async () => {
    const a = await join(viewer);
    const watching = await stream(viewer, `${key(red)}:${a.reply.seq}`);
    // The row leaves the rule's filter.
    await gqlAsOwner('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {team: "blue"}) { team } }', { id: red });
    const frames = await framesUntil(watching.frames!, (frame) => frame.type === 'closed');
    expect(frames.at(-1)).toEqual({ type: 'closed', regionId: key(red), reason: 'access' });
  });

  it('a reader leaving saves the cells they may write, after the grace', async () => {
    const sessions = createRegionSessions({
      db: getDb, keepaliveFrame: () => ': keepalive\n\n', leaveGraceMs: 20,
      subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost),
    });
    try {
      const actor = identityForUser(viewer.id, null, viewer.email) as AccessActor;
      const opened = await sessions.cells.open(actor, pageId, key(red));
      if (opened.status !== 200) throw new Error(`open ${opened.status}`);
      const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { gc: true, clientId: opened.body.clientId });
      const before = Y.encodeStateVector(doc);
      doc.getText('region').insert(0, 'Left: ');
      expect((await sessions.cells.update(actor, pageId, key(red), { clientId: opened.body.clientId, update: Y.encodeStateAsUpdate(doc, before) })).status).toBe(200);
      const abort = new AbortController();
      const watching = await sessions.stream(actor, pageId, `${key(red)}:${opened.body.seq}`, abort.signal);
      expect(watching.status).toBe('open');
      if (watching.status === 'open') void watching.stream.pipeTo(new WritableStream()).catch(() => {});
      const version = await datasetVersion();
      abort.abort();
      await new Promise((resolve) => setTimeout(resolve, 80));
      await sessions.settle();
      expect(await datasetVersion()).toBe(version + 1);
      expect((await stored())[0]!.description).toBe('Left: Fix the login bug');
    } finally { sessions.dispose(); }
  });
});

describe('the dataset write a save makes', () => {
  const actorOf = (person: Person) => identityForUser(person.id, null, person.email) as AccessActor;
  const cell = async (rowId: string) => {
    const located = await locateDatasetCell((await getArtifactById(datasetId))!, rowId, { field: 'description' });
    if (typeof located === 'string') throw new Error(located);
    return located;
  };

  it('is guarded on the head it was merged from: a write that landed first is not overwritten', async () => {
    const stale = (await getArtifactById(datasetId))!;
    const target = await cell(red);
    await gqlAsOwner('mutation($id: ID!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: {description: "Theirs"}) { _id } }', { id: red });
    let effects = 0;
    const outcome = await writeDatasetCells(actorOf(viewer), stale, pageId, target, [{ rowId: red, source: 'description', value: 'Mine' }], async () => { effects++; });
    expect(outcome).toMatchObject({ refused: 'row_changed' });
    expect(effects).toBe(0);
    expect((await stored())[0]!.description).toBe('Theirs');
  });

  it('writes every cell or none: a row the rule does not admit refuses the step', async () => {
    const head = (await getArtifactById(datasetId))!;
    const target = await cell(red);
    const outcome = await writeDatasetCells(actorOf(viewer), head, pageId, target, [
      { rowId: red, source: 'description', value: 'red typed' },
      { rowId: blue, source: 'description', value: 'blue typed' },
    ], async () => {});
    expect(outcome).toMatchObject({ refused: 'denied' });
    expect(await datasetVersion()).toBe(head.version);
    expect((await stored()).map((row) => row.description)).toEqual(['Fix the login bug', 'Write the docs']);
    const allowed = await writeDatasetCells(actorOf(viewer), head, pageId, target, [{ rowId: red, source: 'description', value: 'red typed' }], async () => {});
    expect('written' in allowed && allowed.written.version).toBe(head.version + 1);
  });
});

describe('text the dataset will not take', () => {
  /** The policy with the viewer's update rule refusing one description ("Fix the login bug ok!!"). */
  const withCheck = async () => {
    const head = (await getArtifactById(datasetId))!;
    const policy = POLICY();
    const viewerRule = policy.tables[0]!.update_permissions.find((entry) => entry.role === 'viewer')!;
    (viewerRule.permission as Record<string, unknown>).check = { description: { _neq: 'Fix the login bug ok!!' } };
    const saved = await patchMetadata(ownerToken, datasetId, { policy, expectedPolicyRevision: head.policy_revision ?? 0 });
    expect(saved.status, await saved.clone().text()).toBe(200);
  };

  it('an update the rule\'s check refuses is check_violation, and nothing of it is stored', async () => {
    await withCheck();
    const a = await join(viewer);
    a.text.insert(a.text.length, ' ok');
    expect((await a.push()).status).toBe(200);
    a.text.insert(a.text.length, '!!');
    const refused = await a.push();
    expect(refused).toEqual({ status: 422, body: { error: 'check_violation' } });
    // The owner (no rule applies) may type it; the viewer's next session starts from the stored text.
    const b = await join(viewer);
    expect(b.value()).toBe('Fix the login bug ok');
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 1 });
    expect((await stored())[0]!.description).toBe('Fix the login bug ok');
  });

  it('a check with pattern operators decides as the engine will: an admitted text saves, a refused one is check_violation', async () => {
    const head = (await getArtifactById(datasetId))!;
    const policy = POLICY();
    const viewerRule = policy.tables[0]!.update_permissions.find((entry) => entry.role === 'viewer')!;
    (viewerRule.permission as Record<string, unknown>).check = { _and: [{ description: { _nlike: '%TODO%' } }, { description: { _ilike: 'fix%' } }] };
    expect((await patchMetadata(ownerToken, datasetId, { policy, expectedPolicyRevision: head.policy_revision ?? 0 })).status).toBe(200);
    const a = await join(viewer);
    a.text.insert(a.text.length, ' today');
    expect((await a.push()).status).toBe(200);
    a.text.insert(a.text.length, ' TODO');
    expect(await a.push()).toEqual({ status: 422, body: { error: 'check_violation' } });
    const before = await datasetVersion();
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 1 });
    expect(await datasetVersion()).toBe(before + 1);
    expect((await stored())[0]!.description).toBe('Fix the login bug today');
    expect((await (await getDb()).query("SELECT 1 FROM region_states WHERE artifact_id = $1 AND region_id LIKE 'cell:%'", [datasetId])).rows).toHaveLength(1);
  });

  it('an update rule filtering on the row ID (_id) admits that row\'s cell, to open and to save', async () => {
    const head = (await getArtifactById(datasetId))!;
    const policy = POLICY();
    const viewerRule = policy.tables[0]!.update_permissions.find((entry) => entry.role === 'viewer')!;
    (viewerRule.permission as Record<string, unknown>).filter = { _id: { _eq: red } };
    (viewerRule.permission as Record<string, unknown>).check = { _id: { _neq: blue } };
    expect((await patchMetadata(ownerToken, datasetId, { policy, expectedPolicyRevision: head.policy_revision ?? 0 })).status).toBe(200);
    expect((await open(viewer, key(blue))).status).toBe(404);
    const a = await join(viewer);
    a.text.insert(0, 'By id: ');
    expect((await a.push()).status).toBe(200);
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 1 });
    expect((await stored())[0]!.description).toBe('By id: Fix the login bug');
  });

  it('a save the dataset refuses closes the cell for everyone (closed: rejected) and leaves nothing dirty', async () => {
    const a = await join(viewer);
    const watching = await stream(viewer, `${key(red)}:${a.reply.seq}`);
    a.text.insert(a.text.length, ' ok!!');
    expect((await a.push()).status).toBe(200);
    // The owner adds the check after the typing: only the engine sees it at save.
    await withCheck();
    const before = await datasetVersion();
    expect(await (await flushCells(viewer)).json()).toEqual({ saved: 0 });
    expect(await datasetVersion()).toBe(before);
    const frames = await framesUntil(watching.frames!, (frame) => frame.type === 'closed');
    expect(frames.at(-1)).toEqual({ type: 'closed', regionId: key(red), reason: 'rejected' });
    expect((await (await getDb()).query("SELECT 1 FROM region_states WHERE artifact_id = $1 AND region_id LIKE 'cell:%'", [datasetId])).rows).toEqual([]);
    expect((await stored())[0]!.description).toBe('Fix the login bug');
    // A new session starts clean from the stored text.
    expect((await join(viewer)).value()).toBe('Fix the login bug');
  });
});

describe('the flag in the GraphQL schema', () => {
  it('describes a collaborative field in the dataset\'s and the page\'s SDL, and no other', async () => {
    const sdl = async (id: string) => {
      const response = await graphqlSchema(request(`/api/artifacts/${id}/graphql`, { token: ownerToken }), { params: Promise.resolve({ id }) });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()).sdl as string;
    };
    // As generated (one line) and as the page composition prints it (a block string): the description precedes the field.
    const described = (field: string) => new RegExp(`Collaborative: typed live together with @afbin/collab \\(collaborative_columns\\)\\."+\\s*${field}: String`);
    for (const text of [await sdl(datasetId), await sdl(pageId)]) {
      expect(text).toMatch(described('description'));
      expect(text).toMatch(described('notes'));
      expect(text).not.toMatch(described('title'));
      expect(text.match(/Collaborative: typed live together/g)).toHaveLength(2);
    }
  });
});
