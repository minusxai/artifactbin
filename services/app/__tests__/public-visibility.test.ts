/**
 * Public visibility is an explicit deployment setting. An authenticated account's
 * default stays private whether or not public publishing is enabled. Unlisted
 * links remain available; anonymous API creation remains unauthorized.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

/** Re-import the world with the flag in a given state — config reads env at module load. */
async function withPublic(enabled: boolean) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ARTIFACTS__ALLOW_PUBLIC', enabled ? '1' : '');
  if (!enabled) delete process.env.ARTIFACTS__ALLOW_PUBLIC;
  const [{ POST: createArtifact }, { createUser, mintToken }] = await Promise.all([
    import('@/app/api/artifacts/route'),
    import('@/lib/accounts'),
  ]);
  // Import account creation and minting from the same reset module graph as
  // the route so these fixtures use its deployment config and current DB.
  const sharingRoute = await import('@/app/api/my/artifacts/[id]/sharing/route');
  const { getDb } = await import('@/lib/platform/db');
  const user = await createUser({ email: 'mxmx_test_visibility@example.test' });
  const { token } = await mintToken('visibility', user.id);
  const { overrideSession } = await import('@/auth');
  overrideSession(() => ({ user: { id: user.id, email: user.email } }));
  return {
    group: async () => {
      const db = await getDb();
      await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES('grp_visibility','visibility_team','Team',$1)", [user.id]);
      await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES('grp_visibility',$1,'editor')", [user.id]);
    },
    sharing: (id: string, patch?: Record<string, unknown>) => sharingRoute[patch ? 'PUT' : 'GET'](request(`/api/my/artifacts/${id}/sharing`, { method: patch ? 'PUT' : 'GET', json: patch }), { params: Promise.resolve({ id }) }),
    anonymousCreate: (body: Record<string, unknown>) => createArtifact(new Request(`${BASE}/api/artifacts`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
    create: (body: Record<string, unknown>) => createArtifact(new Request(`${BASE}/api/artifacts`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    })),
  };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('a deployment that has not opened public visibility', () => {
  it('refuses an EXPLICIT public by name, and says which setting opens it', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'p', markup: '<div><p>x</p></div>', visibility: 'public' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe('public_not_enabled');
    expect(`${body.hint ?? ''}`).toMatch(/ARTIFACTS__ALLOW_PUBLIC/);
  });

  it('still takes unlisted — "anyone with the link" was never the part behind the setting', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'u', markup: '<div><p>x</p></div>', visibility: 'unlisted' });
    expect(res.status).toBe(201);
    expect((await res.json()).visibility).toBe('unlisted');
  });

  it('keeps an account document private when no visibility was requested', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'a', markup: '<div><p>x</p></div>' });
    expect(res.status).toBe(201);
    expect((await res.json()).visibility).toBe('private');
  });
});

describe('a deployment that HAS opened it (this suite, and the public one)', () => {
  it('takes explicit public and keeps the account default private', async () => {
    const w = await withPublic(true);
    const publicDocument = await w.create({ title: 'p', markup: '<div><p>x</p></div>', visibility: 'public' });
    expect(publicDocument.status).toBe(201);
    expect((await publicDocument.json()).visibility).toBe('public');
    const defaultDocument = await w.create({ title: 'a', markup: '<div><p>x</p></div>' });
    expect(defaultDocument.status).toBe(201);
    expect((await defaultDocument.json()).visibility).toBe('private');
  });
});

it.each([false, true])('public enabled=%s never enables anonymous creation', async (enabled) => {
  const w = await withPublic(enabled);
  const response = await w.anonymousCreate({ markup: '<p>Anonymous</p>', visibility: 'unlisted' });
  expect(response.status).toBe(401);
  expect((await response.json()).error).toBe('unauthorized');
});


it.each([false, true])('sharing reads and updates expose public enabled=%s', async (enabled) => {
  const w = await withPublic(enabled);
  const created = await w.create({ markup: '<p>Team review</p>', visibility: 'private' });
  expect(created.status).toBe(201);
  const { id } = await created.json();
  expect(await (await w.sharing(id)).json()).toMatchObject({ canPublic: enabled });
  const updated = await w.sharing(id, { visibility: 'unlisted' });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ canPublic: enabled, visibility: 'unlisted' });
  if (!enabled) {
    const refused = await w.sharing(id, { visibility: 'public' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'public_not_enabled' });
    expect(await (await w.sharing(id)).json()).toMatchObject({ visibility: 'unlisted' });
  }
});

it('can restore group-owned link sharing to private', async () => {
  const w = await withPublic(false);
  await w.group();
  const created = await w.create({ markup: '<p>Team review</p>', visibility: 'unlisted', destination: { type: 'group', id: 'grp_visibility' } });
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const updated = await w.sharing(id, { visibility: 'private' });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ visibility: 'private', canPrivate: true });
});
