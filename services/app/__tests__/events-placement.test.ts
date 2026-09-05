/**
 * THE PLACEMENT MOMENTS — the log's half of the folders and the trash.
 *
 * Four sentences, at the doors that actually change something: a `moved` at
 * both placement doors (the PATCH and a replace that files the row), a
 * `trashed` carrying what went with it, a `restored` saying where the row
 * landed, and `deleted` ONLY from the purge — which is the whole point of the
 * distinct vocabulary. A trash that said `deleted` would tell an operator a
 * document was erased while it is sitting in the owner's trash, restorable.
 *
 * `created`'s payload names the parent for the same reason: a folder create
 * and a filed create are the two moments this feature exists to make, and a
 * log that cannot tell either from a root create records nothing about it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { agentCookie, request, useAppHarness } from './harness';
import { PATCH as patchRoute, DELETE as deleteRoute } from '@/app/api/my/artifacts/[id]/route';
import { POST as restoreRoute } from '@/app/api/my/artifacts/[id]/restore/route';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { PUT as replaceOneRoute } from '@/app/api/artifacts/[id]/route';
import { getDb } from '@/lib/db';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { purgeTrash } from '@/lib/trash';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let fake: FakeEvents;
/** A fresh log per assertion, so a fixture's own moments never count against the one under test. */
const listen = () => { fake = fakeEvents(); setServices({ events: fake }); };
beforeEach(listen);

const verbs = () => fake.events.filter((e) => e.object_kind === 'artifact').map((e) => e.verb);
const said = (verb: string) => fake.events.filter((e) => e.verb === verb);

async function world() {
  const t = await mintToken('o');
  const u = await createUser({ email: 'mxmx_test_placement@example.com' });
  await claimToken(u.id, t.token);
  const cookie = await agentCookie([t.id]);
  const mk = async (body: Record<string, unknown>) => {
    const r = await createRoute(request('/api/artifacts', { method: 'POST', json: body, token: t.token }));
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string };
  };
  return { token: t.token, tokenId: t.id, userId: u.id, cookie, mk };
}

describe('a create says where it landed', () => {
  it('a root create names no parent, and a filed one names the folder', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    // trackEvent is fire-and-forget; the emit is the last thing it does.
    await new Promise((r) => setTimeout(r, 50));
    expect(said('created').at(-1)?.payload).toMatchObject({ parent_id: null });
    listen();
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D', parent_id: folder.id });
    await new Promise((r) => setTimeout(r, 50));
    const created = said('created').at(-1);
    expect(created?.object_id).toBe(doc.id);
    expect(created?.payload).toMatchObject({ parent_id: folder.id });
  });
});

describe('a move is its own verb, at both placement doors', () => {
  it('PATCH parent_id says artifact.moved once, naming both ends', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D' });
    listen();
    const r = await patchRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { parent_id: folder.id }, cookie: w.cookie }), params(doc.id));
    expect(r.status).toBe(200);
    const moved = said('moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ object_kind: 'artifact', object_id: doc.id, subject_kind: 'user', subject_id: w.userId, payload: { from_parent_id: null, to_parent_id: folder.id } });
  });

  it('a move back to the root names the root as null', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D', parent_id: folder.id });
    listen();
    await patchRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { parent_id: null }, cookie: w.cookie }), params(doc.id));
    expect(said('moved')[0]?.payload).toMatchObject({ from_parent_id: folder.id, to_parent_id: null });
  });

  it('a PUT that files the row says it too, and a PUT that does not says nothing', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D' });
    listen();
    const filed = await replaceOneRoute(request(`/api/artifacts/${doc.id}`, { method: 'PUT', json: { markup: '<h1>y</h1>', title: 'D', parent_id: folder.id }, token: w.token }), params(doc.id));
    expect(filed.status).toBe(200);
    expect(said('moved')[0]).toMatchObject({ object_id: doc.id, payload: { from_parent_id: null, to_parent_id: folder.id } });
    listen();
    const plain = await replaceOneRoute(request(`/api/artifacts/${doc.id}`, { method: 'PUT', json: { markup: '<h1>z</h1>', title: 'D' }, token: w.token }), params(doc.id));
    expect(plain.status).toBe(200);
    expect(said('moved')).toHaveLength(0);
  });
});

describe('a trash is trashed, never deleted', () => {
  it('DELETE says artifact.trashed with the format and no subtree, and never artifact.deleted', async () => {
    const w = await world();
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D' });
    listen();
    const r = await deleteRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE', cookie: w.cookie }), params(doc.id));
    expect(r.status).toBe(200);
    expect(said('trashed')).toHaveLength(1);
    expect(said('trashed')[0]).toMatchObject({ object_id: doc.id, subject_kind: 'user', subject_id: w.userId, payload: { format: 'markup', subtree: 0 } });
    expect(verbs()).not.toContain('deleted');
  });

  it('trashing a folder counts what went with it', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    await w.mk({ markup: '<h1>a</h1>', title: 'A', parent_id: folder.id });
    await w.mk({ markup: '<h1>b</h1>', title: 'B', parent_id: folder.id });
    listen();
    await deleteRoute(request(`/api/my/artifacts/${folder.id}`, { method: 'DELETE', cookie: w.cookie }), params(folder.id));
    expect(said('trashed')[0]).toMatchObject({ object_id: folder.id, payload: { format: 'folder', subtree: 2 } });
  });

  it('a restore says where the row landed', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D', parent_id: folder.id });
    await deleteRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE', cookie: w.cookie }), params(doc.id));
    listen();
    const r = await restoreRoute(request(`/api/my/artifacts/${doc.id}/restore`, { method: 'POST', cookie: w.cookie }), params(doc.id));
    expect(r.status).toBe(200);
    expect(said('restored')).toHaveLength(1);
    expect(said('restored')[0]).toMatchObject({ object_id: doc.id, payload: { landed_at_root: false } });
  });

  it('a restore whose folder is still in the trash says it landed at the root', async () => {
    const w = await world();
    const folder = await w.mk({ format: 'folder', title: 'F' });
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D', parent_id: folder.id });
    await deleteRoute(request(`/api/my/artifacts/${folder.id}`, { method: 'DELETE', cookie: w.cookie }), params(folder.id));
    // Restore the CHILD alone: its folder is still trashed, so it re-roots.
    listen();
    await restoreRoute(request(`/api/my/artifacts/${doc.id}/restore`, { method: 'POST', cookie: w.cookie }), params(doc.id));
    expect(said('restored')[0]?.payload).toMatchObject({ landed_at_root: true });
  });
});

describe('deleted belongs to the purge', () => {
  it('the sweep says artifact.deleted once per row it erased, and nothing else does', async () => {
    const w = await world();
    const doc = await w.mk({ markup: '<h1>x</h1>', title: 'D' });
    await deleteRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE', cookie: w.cookie }), params(doc.id));
    const db = await getDb();
    await db.query(`UPDATE artifacts SET deleted_at = now() - interval '40 days' WHERE id = $1`, [doc.id]);
    listen();
    const purged = await purgeTrash();
    expect(purged).toContain(doc.id);
    await new Promise((r) => setTimeout(r, 50));
    const deleted = said('deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ object_kind: 'artifact', object_id: doc.id });
  });
});
