/**
 * P1 (seeded RED by the orchestrator) — folders are artifacts: the doors.
 * Over the real routes in-process. Plan: ~/projects/artifactbin-folders.md.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute, GET as listRoute } from '@/app/api/artifacts/route';
import { GET as getRoute, DELETE as deleteRoute } from '@/app/api/artifacts/[id]/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { PATCH as patchMineRoute, PUT as putMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { PUT as putRoute } from '@/app/api/artifacts/[id]/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { getArtifactById, updateSharing } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { buildShelf } from '@/lib/shelf';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });

async function owner(name = 'owner') {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, userId: u.id, cookie: await agentCookie([t.id]) };
}
const create = async (token: string, body: Record<string, unknown>) => j(await createRoute(request('/api/artifacts', { method: 'POST', json: body, token })));
const readBack = async (token: string, id: string) => j(await getRoute(request(`/api/artifacts/${id}`, { token }), params(id)));
const move = async (cookie: string, id: string, parent_id: string | null) =>
  j(await patchMineRoute(request(`/api/my/artifacts/${id}`, { method: 'PATCH', json: { parent_id }, cookie, origin: 'same' }), params(id)));

describe('creating a folder', () => {
  it('is an artifact of format folder, at root, with NO content of any kind', async () => {
    const o = await owner();
    const r = await create(o.token, { format: 'folder', title: 'Reports' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const row = (await getArtifactById(r.body.id))!;
    expect(row.format).toBe('folder');
    expect(row.ancestor_ids).toEqual([]);
    // A folder's page is a listing computed from the row, so there is nothing
    // stored on it and nothing to serve (__tests__/folder-page.test.ts).
    expect(row.source).toBe('');
    expect(row.content).toBe('');
    const g = await readBack(o.token, r.body.id);
    expect(g.body.format).toBe('folder');
    expect(g.body.parent_id).toBeNull();
    expect(g.body.ancestor_ids).toEqual([]);
    expect(g.body).not.toHaveProperty('folder');
  });

  it('refuses the retired folder field by name', async () => {
    const o = await owner();
    const r = await create(o.token, { markup: '<h1>x</h1>', folder: '2026/08' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('folder_retired');
    expect(String(r.body.hint ?? r.body.details)).toContain('parent_id');
  });
});

describe('filing under a folder', () => {
  it('a document created with parent_id carries the folder as its ancestors; nested folders extend it', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
    const d = await create(o.token, { markup: '<h1>Q3</h1>', title: 'Q3', parent_id: f.id });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await readBack(o.token, d.body.id)).body).toMatchObject({ parent_id: f.id, ancestor_ids: [f.id] });
    const sub = (await create(o.token, { format: 'folder', title: '2026', parent_id: f.id })).body;
    const deep = (await create(o.token, { markup: '<p>deep</p>', parent_id: sub.id })).body;
    expect((await readBack(o.token, deep.id)).body).toMatchObject({ parent_id: sub.id, ancestor_ids: [f.id, sub.id] });
  });

  it('a parent that is unknown, not a folder, or another owner\'s folder is one refusal: invalid_parent', async () => {
    const o = await owner('a');
    const other = await owner('b');
    const doc = (await create(o.token, { markup: '<p>x</p>' })).body;
    const theirs = (await create(other.token, { format: 'folder', title: 'Theirs' })).body;
    for (const parent_id of ['zzzzzz', doc.id, theirs.id]) {
      const r = await create(o.token, { markup: '<p>y</p>', parent_id });
      expect(r.status, parent_id).toBe(400);
      expect(r.body.error, parent_id).toBe('invalid_parent');
    }
  });

  it('parent validation runs AFTER the scope: a row this caller cannot reach is the uniform 404, whatever the body', async () => {
    const o = await owner('a');
    const stranger = await owner('b');
    const doc = (await create(o.token, { markup: '<p>x</p>' })).body;
    const r = await move(stranger.cookie, doc.id, 'zzzzzz');
    expect(r.status).toBe(404);
  });

  it('no resulting row may sit deeper than 6', async () => {
    const o = await owner();
    let parent: string | null = null;
    for (let level = 1; level <= 6; level++) {
      const r = await create(o.token, { format: 'folder', title: `L${level}`, parent_id: parent });
      expect(r.status, `level ${level}: ${JSON.stringify(r.body)}`).toBe(201);
      parent = r.body.id;
    }
    const seventh = await create(o.token, { markup: '<p>7</p>', parent_id: parent });
    expect(seventh.status).toBe(400);
    expect(seventh.body.error).toBe('invalid_parent');
  });
});

describe('moving', () => {
  it('a document moves with one PATCH; a folder moves with its subtree; a folder cannot move into itself or a descendant', async () => {
    const o = await owner();
    const a = (await create(o.token, { format: 'folder', title: 'A' })).body;
    const b = (await create(o.token, { format: 'folder', title: 'B', parent_id: a.id })).body;
    const c = (await create(o.token, { markup: '<p>c</p>', parent_id: b.id })).body;
    const x = (await create(o.token, { format: 'folder', title: 'X' })).body;
    // document → root
    expect((await move(o.cookie, c.id, null)).status).toBe(200);
    expect((await getArtifactById(c.id))!.ancestor_ids).toEqual([]);
    // document → b again, then move folder A under X: A and B rewrite, c follows
    expect((await move(o.cookie, c.id, b.id)).status).toBe(200);
    const before = (await getArtifactById(c.id))!;
    expect((await move(o.cookie, a.id, x.id)).status).toBe(200);
    expect((await getArtifactById(a.id))!.ancestor_ids).toEqual([x.id]);
    expect((await getArtifactById(b.id))!.ancestor_ids).toEqual([x.id, a.id]);
    const after = (await getArtifactById(c.id))!;
    expect(after.ancestor_ids).toEqual([x.id, a.id, b.id]);
    expect(after.version).toBe(before.version); // metadata-only: no version bump
    expect(after.edit_id).toBe(before.edit_id);
    // cycles
    for (const bad of [a.id, b.id]) {
      const r = await move(o.cookie, a.id, bad);
      expect(r.status, bad).toBe(400);
      expect(r.body.error).toBe('invalid_parent');
    }
  });
});

describe('deleting and forking a folder', () => {
  /*
   * `folder_not_empty` and its `?force` are GONE. They existed because a
   * delete was permanent and a folder full of documents was a decision nobody
   * should discover afterwards; a trash is not that decision, so the refusal
   * asked someone to confirm something that is no longer being done. What is
   * left is the act itself: one statement takes the subtree (lib/trash), and
   * restore reverses it (trash.test.ts).
   */
  it('deleting a folder takes its subtree into the trash, with no refusal and no force', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const sub = (await create(o.token, { format: 'folder', title: 'S', parent_id: f.id })).body;
    const d = (await create(o.token, { markup: '<p>d</p>', parent_id: sub.id })).body;
    const gone = await j(await deleteRoute(request(`/api/artifacts/${f.id}`, { method: 'DELETE', token: o.token }), params(f.id)));
    expect(gone.status).toBe(200);
    expect(gone.body.error).toBeUndefined();
    for (const id of [f.id, sub.id, d.id]) expect(await getArtifactById(id), id).toBeNull();
    const empty = (await create(o.token, { format: 'folder', title: 'E' })).body;
    expect((await deleteRoute(request(`/api/artifacts/${empty.id}`, { method: 'DELETE', token: o.token }), params(empty.id))).status).toBe(200);
  });

  /*
   * The delete takes the subtree by CONTAINMENT, so the rows it takes are
   * decided by a rule (`resolveParent`: a parent is a folder the SAME owner
   * holds) enforced in another module. An ACL that rests on a neighbour's
   * invariant is one refactor from being wrong, so the owner predicate sits in
   * the SAME WHERE as the containment and not only on the folder that was
   * named. Unreachable through the doors today — which is why the foreign
   * child is planted with SQL.
   */
  it('deleting a folder takes only rows the actor owns, whatever the containment says', async () => {
    const o = await owner();
    const stranger = await owner('stranger');
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const mine = (await create(o.token, { markup: '<p>mine</p>', parent_id: f.id })).body;
    const theirs = (await create(stranger.token, { markup: '<p>theirs</p>' })).body;
    const db = await getDb();
    await db.query('UPDATE artifacts SET ancestor_ids = $2::text[] WHERE id = $1', [theirs.id, [f.id]]);

    const gone = await deleteRoute(request(`/api/artifacts/${f.id}`, { method: 'DELETE', token: o.token }), params(f.id));
    expect(gone.status).toBe(200);
    for (const id of [f.id, mine.id]) expect(await getArtifactById(id), id).toBeNull();
    expect(await getArtifactById(theirs.id), 'the stranger keeps their document').not.toBeNull();
    const rest = await db.query('SELECT deleted_at FROM artifacts WHERE id = $1', [theirs.id]);
    expect(rest.rows[0].deleted_at, 'and it was never even stamped').toBeNull();
  });

  it('fork_artifact on a folder answers 400 not_forkable', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const r = await j(await forkOpRoute(request(`/api/artifacts/${f.id}/fork`, { method: 'POST', token: o.token }), params(f.id)));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not_forkable');
  });
});

describe('a folder is not a document', () => {
  /**
   * NOTHING SERVES A FOLDER'S CONTENT, because it has none. `raw` is the
   * uniform 404 for one — the same answer an unknown id gets — for its owner as
   * much as for a stranger, and that is what keeps `/a/<folder>` on the app
   * page for everybody: `servesDocumentDirectly` would otherwise hand a reader
   * a 404 at the address they were given.
   */
  it('raw answers the uniform 404 for a folder, to its owner and to a stranger alike', async () => {
    const o = await owner();
    for (const visibility of ['public', 'private'] as const) {
      const f = (await create(o.token, { format: 'folder', title: 'F', visibility })).body;
      expect((await rawRoute(request(`/a/${f.id}/raw`, { cookie: o.cookie }), params(f.id))).status, visibility).toBe(404);
      expect((await rawRoute(request(`/a/${f.id}/raw`), params(f.id))).status, visibility).toBe(404);
    }
  });

  /**
   * A FOLDER TAKES NO EDIT, and it answers the code the DATA TIERS answer —
   * `not_editable`, which already means "this is not a document, replace it
   * whole instead". There is no second word to learn and no second rule: the
   * edit protocol asks `isDocumentFormat`, and a folder is not one.
   */
  it('refuses the edit protocol with the code the data tiers answer', async () => {
    const o = await owner();
    const folder = (await create(o.token, { format: 'folder', title: 'Before' })).body;
    const refusedFolder = await j(await editRoute(
      request(`/api/artifacts/${folder.id}/edits`, { method: 'POST', token: o.token, json: { edit_id: folder.edit_id, title: 'After' } }),
      params(folder.id),
    ));
    expect(refusedFolder.status).toBe(400);
    expect(refusedFolder.body).toMatchObject({ error: 'not_editable' });
    expect((await getArtifactById(folder.id))!.title, 'the title is unchanged').toBe('Before');
    const ds = (await create(o.token, { dataset: [{ a: 1 }] })).body;
    const refused = await j(await editRoute(
      request(`/api/artifacts/${ds.id}/edits`, { method: 'POST', token: o.token, json: { edit_id: ds.edit_id, title: 'nope' } }),
      params(ds.id),
    ));
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: 'not_editable' });
  });

  it('the list carries parent_id and ancestor_ids and the shelf files folders in their own partition', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    await create(o.token, { markup: '<p>d</p>', parent_id: f.id });
    const list = await j(await listRoute(request('/api/artifacts', { token: o.token })));
    expect(list.status).toBe(200);
    const rows: any[] = list.body.artifacts;
    expect(rows.find((r) => r.id === f.id)).toMatchObject({ format: 'folder', parent_id: null, ancestor_ids: [] });
    expect(rows.find((r) => r.format === 'markup')).toMatchObject({ parent_id: f.id, ancestor_ids: [f.id] });
    for (const r of rows) expect(r).not.toHaveProperty('folder');
    const shelf = buildShelf(rows.map((r) => ({ ...r, updated_at: r.updated_at })));
    expect(shelf.folders.map((r: any) => r.id)).toEqual([f.id]);
    expect(shelf.assets).toEqual([]);
    expect(shelf.total).toBe(1);
  });
});

/*
 * A FOLDER'S PUT IS A METADATA EDIT, AND METADATA HAS ONE CODE PATH.
 *
 * A folder has no content, so nothing about one is ever "replaced": the whole
 * body a folder takes — `title`, `visibility`, `parent_id` — is the metadata
 * the PATCH door already writes, and routing it through the replace door meant
 * a version, an archived copy of the empty state and an edit-log row for a
 * string. The version number is what a caller diffs to learn "the document
 * changed", so a rename that moves it says a document changed when nothing did.
 *
 * So both doors run the SAME writes (lib/artifacts setMetadataFor): PATCH is
 * unchanged, and PUT on a folder now does what PATCH does.
 */
describe("a folder's PUT is a metadata edit", () => {
  /** The two ledgers a replace writes and a metadata write must not. */
  const ledgers = async (id: string) => {
    const db = await getDb();
    const v = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM artifact_versions WHERE artifact_id = $1', [id]);
    const e = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM artifact_edits WHERE artifact_id = $1', [id]);
    return { versions: v.rows[0].n, edits: e.rows[0].n };
  };
  const putBearer = async (token: string, id: string, body: Record<string, unknown>) =>
    j(await putRoute(request(`/api/artifacts/${id}`, { method: 'PUT', json: body, token }), params(id)));
  const putSession = async (cookie: string, id: string, body: Record<string, unknown>) =>
    j(await putMineRoute(request(`/api/my/artifacts/${id}`, { method: 'PUT', json: body, cookie, origin: 'same' }), params(id)));

  it('renames through PUT with no version, no archived copy and no edit-log row — at either door', async () => {
    const o = await owner();
    for (const [door, run] of [
      ['bearer', (id: string) => putBearer(o.token, id, { title: 'Renamed' })],
      ['session', (id: string) => putSession(o.cookie, id, { title: 'Renamed' })],
    ] as const) {
      const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
      const before = (await getArtifactById(f.id))!;
      const beforeLedgers = await ledgers(f.id);
      const r = await run(f.id);
      expect(r.status, `${door}: ${JSON.stringify(r.body)}`).toBe(200);
      const after = (await getArtifactById(f.id))!;
      expect(after.title, door).toBe('Renamed');
      expect(after.version, door).toBe(before.version);
      expect(await ledgers(f.id), door).toEqual(beforeLedgers);
      // …and the reply is the ordinary update reply, at the version the row is at.
      expect(r.body, door).toMatchObject({ id: f.id, version: before.version, visibility: after.visibility });
    }
  });

  it('files and re-tiers through PUT the same way — placement and visibility move nothing else', async () => {
    const o = await owner();
    const box = (await create(o.token, { format: 'folder', title: 'Box' })).body;
    const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
    const before = (await getArtifactById(f.id))!;
    const beforeLedgers = await ledgers(f.id);
    expect((await putBearer(o.token, f.id, { parent_id: box.id })).status).toBe(200);
    let after = (await getArtifactById(f.id))!;
    expect(after.ancestor_ids).toEqual([box.id]);
    expect(after.version).toBe(before.version);
    expect(await ledgers(f.id)).toEqual(beforeLedgers);
    expect((await putBearer(o.token, f.id, { visibility: 'unlisted' })).status).toBe(200);
    after = (await getArtifactById(f.id))!;
    expect(after.visibility).toBe('unlisted');
    expect(after.version).toBe(before.version);
    expect(await ledgers(f.id)).toEqual(beforeLedgers);
  });

  /*
   * THE CAS SURVIVES THE CHANGE. `expectedVersion` is a caller asking to be
   * REFUSED if the row moved under them, and a door where nothing moves the
   * version would answer 200 to every one of them — honouring it by accident
   * for as long as the replace door happened to be the one running.
   */
  it('still refuses a stale expectedVersion, and takes a current one', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
    const version = (await getArtifactById(f.id))!.version;
    const stale = await putBearer(o.token, f.id, { title: 'Nope', expectedVersion: version + 1 });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body).toMatchObject({ error: 'version_conflict', currentVersion: version });
    expect((await getArtifactById(f.id))!.title, 'and nothing was written').toBe('Reports');
    const ok = await putBearer(o.token, f.id, { title: 'Renamed', expectedVersion: version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await getArtifactById(f.id))!.title).toBe('Renamed');
  });

  /*
   * …AND METADATA IS THE OWNER'S, at this door as at every other one. The
   * replace door runs under `editorScope` — an editor may rewrite a DOCUMENT —
   * but a folder has no document to rewrite, and its name, tier and placement
   * are the owner's the way sharing and deletion are (lib/artifacts
   * ownerScope). The refusal is the uniform 404, which is what every other
   * owner-only surface answers them.
   */
  it("is the owner's: a named editor of a folder is the uniform 404", async () => {
    const o = await owner('boxowner');
    const editor = await owner('boxeditor');
    const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
    await updateSharing(o.userId, f.id, { shares: [{ email: 'boxeditor@example.com', role: 'editor' }] });
    const r = await putBearer(editor.token, f.id, { title: 'Theirs' });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect((await getArtifactById(f.id))!.title).toBe('Reports');
  });

  /*
   * ONE ACT, TWO DOORS. The title is sent with the whitespace a person's field
   * or an agent's JSON carries, because a trim that happens at only one door is
   * exactly how the two paths drift while both look right.
   */
  it('is the same act as PATCH: the same trimmed title, and a row byte-identical apart from title and updated_at', async () => {
    const o = await owner();
    const rest = (row: Record<string, unknown>) => {
      const { title, updated_at, ...keep } = row;
      return keep;
    };
    const doors = [
      ['PATCH', async (id: string) => j(await patchMineRoute(request(`/api/my/artifacts/${id}`, { method: 'PATCH', json: { title: '  Quarterly  ' }, cookie: o.cookie, origin: 'same' }), params(id)))],
      ['PUT', async (id: string) => putBearer(o.token, id, { title: '  Quarterly  ' })],
    ] as const;
    for (const [door, run] of doors) {
      const f = (await create(o.token, { format: 'folder', title: 'Reports' })).body;
      const before = (await getArtifactById(f.id))!;
      const r = await run(f.id);
      expect(r.status, `${door}: ${JSON.stringify(r.body)}`).toBe(200);
      const after = (await getArtifactById(f.id))!;
      expect(after.title, door).toBe('Quarterly');
      expect(rest(after as unknown as Record<string, unknown>), door).toEqual(rest(before as unknown as Record<string, unknown>));
    }
  });
});
