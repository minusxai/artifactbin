/** P3 (seeded RED) — delete is a trash: gone everywhere, restorable, purged after 30 days. */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as getRoute, DELETE as deleteRoute } from '@/app/api/artifacts/[id]/route';
import { getArtifactById, type TokenActor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken, resolveToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { listTrashFor, purgeTrash, restoreArtifactFor } from '@/lib/trash';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
async function owner() {
  const t = await mintToken('o');
  const u = await createUser({ email: 'o@example.com' });
  await claimToken(u.id, t.token);
  const actor = (await resolveToken(t.token)) as unknown as TokenActor;
  return { token: t.token, actor };
}
const create = async (token: string, body: Record<string, unknown>) => { const r = await j(await createRoute(request('/api/artifacts', { method: 'POST', json: body, token }))); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body; };
const del = (token: string, id: string) => deleteRoute(request(`/api/artifacts/${id}`, { method: 'DELETE', token }), params(id));
const readBack = (token: string, id: string) => getRoute(request(`/api/artifacts/${id}`, { token }), params(id));

describe('the trash', () => {
  it('a deleted document answers 404 everywhere, is listed in the trash, and restore brings it back at its version', async () => {
    const o = await owner();
    const d = await create(o.token, { markup: '<p>x</p>', title: 'Doc' });
    expect((await del(o.token, d.id)).status).toBe(200);
    expect((await readBack(o.token, d.id)).status).toBe(404);
    expect(await getArtifactById(d.id)).toBeNull();
    expect((await listTrashFor(o.actor)).map((r) => r.id)).toEqual([d.id]);
    expect(await restoreArtifactFor(o.actor, d.id)).toMatchObject({ id: d.id, ancestor_ids: [] });
    const back = await j(await readBack(o.token, d.id));
    expect(back.status).toBe(200);
    expect(back.body.version).toBe(1);
    expect(await listTrashFor(o.actor)).toEqual([]);
  });

  it('deleting a folder trashes its subtree in one act; restoring the folder restores it; restoring a child whose parent is still trashed lands at root', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'F' });
    const sub = await create(o.token, { format: 'folder', title: 'S', parent_id: f.id });
    const d = await create(o.token, { markup: '<p>d</p>', parent_id: sub.id });
    expect((await del(o.token, f.id)).status).toBe(200);
    for (const id of [f.id, sub.id, d.id]) expect(await getArtifactById(id), id).toBeNull();
    expect(await restoreArtifactFor(o.actor, d.id)).toMatchObject({ id: d.id, ancestor_ids: [] });
    expect(await restoreArtifactFor(o.actor, f.id)).toMatchObject({ id: f.id, ancestor_ids: [] });
    expect((await getArtifactById(sub.id))!.ancestor_ids).toEqual([f.id]);
  });

  it('there is no refusal any more: a folder with children deletes (into the trash) without force', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'F' });
    await create(o.token, { markup: '<p>d</p>', parent_id: f.id });
    const r = await j(await del(o.token, f.id));
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
  });

  it('the purge hard-deletes only what has sat in the trash longer than the retention', async () => {
    const o = await owner();
    const old = await create(o.token, { markup: '<p>old</p>' });
    const fresh = await create(o.token, { markup: '<p>fresh</p>' });
    await del(o.token, old.id); await del(o.token, fresh.id);
    const db = await getDb();
    await db.query(`UPDATE artifacts SET deleted_at = now() - interval '31 days' WHERE id = $1`, [old.id]);
    expect((await purgeTrash({ olderThanDays: 30 })).sort()).toEqual([old.id]);
    expect((await db.query('SELECT id FROM artifacts WHERE id = $1', [old.id])).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM artifacts WHERE id = $1', [fresh.id])).rows).toHaveLength(1);
    expect((await listTrashFor(o.actor)).map((r) => r.id)).toEqual([fresh.id]);
  });
});
