/**
 * P1 (seeded RED by the orchestrator) — folders are artifacts: the doors.
 * Over the real routes in-process. Plan: ~/projects/artifactbin-folders.md.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute, GET as listRoute } from '@/app/api/artifacts/route';
import { GET as getRoute, DELETE as deleteRoute } from '@/app/api/artifacts/[id]/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { PATCH as patchMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { getArtifactById } from '@/lib/artifacts';
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
  it('is an artifact of format folder, at root, stamped with the scaffold naming its own id', async () => {
    const o = await owner();
    const r = await create(o.token, { format: 'folder', title: 'Reports' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const row = (await getArtifactById(r.body.id))!;
    expect(row.format).toBe('folder');
    expect(row.ancestor_ids).toEqual([]);
    expect(row.source).toContain(`ref_${r.body.id}`);
    expect(row.source).toContain('<Files data="$children"');
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
  it('a folder with children answers 409 folder_not_empty with the count; force deletes the subtree', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const sub = (await create(o.token, { format: 'folder', title: 'S', parent_id: f.id })).body;
    const d = (await create(o.token, { markup: '<p>d</p>', parent_id: sub.id })).body;
    const refused = await j(await deleteRoute(request(`/api/artifacts/${f.id}`, { method: 'DELETE', token: o.token }), params(f.id)));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('folder_not_empty');
    expect(refused.body.count).toBe(2);
    expect(await getArtifactById(f.id)).not.toBeNull();
    const forced = await deleteRoute(request(`/api/artifacts/${f.id}?force=true`, { method: 'DELETE', token: o.token }), params(f.id));
    expect(forced.status).toBe(200);
    for (const id of [f.id, sub.id, d.id]) expect(await getArtifactById(id), id).toBeNull();
    const empty = (await create(o.token, { format: 'folder', title: 'E' })).body;
    expect((await deleteRoute(request(`/api/artifacts/${empty.id}`, { method: 'DELETE', token: o.token }), params(empty.id))).status).toBe(200);
  });

  /*
   * The forced delete collects the subtree by CONTAINMENT and then deletes it,
   * so the rows it takes are decided by a rule (`resolveParent`: a parent is a
   * folder the SAME owner holds) enforced in another module. An ACL that rests
   * on a neighbour's invariant is one refactor from being wrong, so the
   * deletion re-applies the owner scope to every row it takes and not only to
   * the folder that was named. Unreachable through the doors today — which is
   * why the foreign child is planted with SQL.
   */
  it('a forced delete takes only rows the actor owns, whatever the containment says', async () => {
    const o = await owner();
    const stranger = await owner('stranger');
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const mine = (await create(o.token, { markup: '<p>mine</p>', parent_id: f.id })).body;
    const theirs = (await create(stranger.token, { markup: '<p>theirs</p>' })).body;
    const db = await getDb();
    await db.query('UPDATE artifacts SET ancestor_ids = $2::text[] WHERE id = $1', [theirs.id, [f.id]]);

    const forced = await deleteRoute(request(`/api/artifacts/${f.id}?force=true`, { method: 'DELETE', token: o.token }), params(f.id));
    expect(forced.status).toBe(200);
    for (const id of [f.id, mine.id]) expect(await getArtifactById(id), id).toBeNull();
    expect(await getArtifactById(theirs.id), 'the stranger keeps their document').not.toBeNull();
    const rest = await db.query('SELECT count(*)::int AS n FROM artifact_edits WHERE artifact_id = $1', [theirs.id]);
    expect(rest.rows[0].n, 'and its history').toBeGreaterThan(0);
  });

  it('fork_artifact on a folder answers 400 not_forkable', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F' })).body;
    const r = await j(await forkOpRoute(request(`/api/artifacts/${f.id}/fork`, { method: 'POST', token: o.token }), params(f.id)));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not_forkable');
  });
});

describe('a folder is served as a document', () => {
  it('raw answers the folder document for its owner and the uniform 404 for a stranger when private', async () => {
    const o = await owner();
    const f = (await create(o.token, { format: 'folder', title: 'F', visibility: 'private' })).body;
    const mine = await rawRoute(request(`/a/${f.id}/raw`, { cookie: o.cookie }), params(f.id));
    expect(mine.status).toBe(200);
    expect(mine.headers.get('content-type')).toContain('text/html');
    expect(await mine.text()).toContain(`ref_${f.id}`);
    const theirs = await rawRoute(request(`/a/${f.id}/raw`), params(f.id));
    expect(theirs.status).toBe(404);
  });

  it('takes an EDIT like any document — which is what renaming one is', async () => {
    /*
     * RENAMING A FOLDER IS THE EDITOR'S TITLE FIELD, and that field writes
     * through the edit protocol like every other change. The protocol refused
     * a folder outright (`not_editable`, the guard that keeps the DATA TIERS
     * out — a table and a picture are values, not documents), so the shell
     * opened an editor on a folder that could never commit: the name went
     * back to what it was, with a 400 nobody was shown. A folder's source is
     * ordinary markup and the plan says it is edited like any document.
     */
    const o = await owner();
    const folder = (await create(o.token, { format: 'folder', title: 'Before' })).body;
    const edited = j(await editRoute(
      request(`/api/artifacts/${folder.id}/edits`, { method: 'POST', token: o.token, json: { edit_id: folder.edit_id, title: 'After' } }),
      params(folder.id),
    ));
    expect((await edited).status, JSON.stringify((await edited).body)).toBe(200);
    expect((await getArtifactById(folder.id))!.title).toBe('After');
    // A DATA TIER is still refused: it is a value, not a document.
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
