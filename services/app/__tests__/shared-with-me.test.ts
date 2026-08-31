/**
 * "Shared with me": the recipient-side listing of `artifact_shares`.
 *
 * A share used to grant DIRECT-LINK access only — lose the link and the
 * document was gone, because `artifact_shares` was consulted by nothing but
 * `canReadArtifact`. `listSharedWithEmail` is the rediscovery surface: every
 * artifact whose share list names the viewer's email, newest first, with the
 * owner's handle so the row can say who shared it.
 *
 * Rules pinned here:
 *  - matching is by the invitee's EMAIL, case-insensitively (invites can
 *    predate the account, and canReadArtifact compares lowercased),
 *  - the viewer's own artifacts never appear (self-share is not a discovery),
 *  - unsharing removes the row (the dialog full-replaces the list),
 *  - a share whose artifact was deleted lists nothing (no dangling rows).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE as deleteArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, listSharedWithEmail, setUsername } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function ownerFixture() {
  const owner = await ensureUsername(await createUser({ email: 'share-owner@example.com' }));
  await setUsername(owner.id, 'shareowner');
  const t = await mintToken('share');
  await claimToken(owner.id, t.token);
  return { owner, token: t.token };
}

const create = async (token: string, title: string) => {
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { title, markup: `<h1>${title}</h1>` } }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; visibility: string };
};

const share = async (ownerId: string, id: string, emails: string[]) => {
  sessionUser.id = ownerId;
  sessionUser.email = 'share-owner@example.com';
  const res = await putSharingRoute(
    request(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', json: { shares: emails } }),
    params({ id }),
  );
  expect(res.status).toBe(200);
};

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('listSharedWithEmail', () => {
  it('lists a shared private document with the owner handle; unshared docs stay absent', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, 'quarterly plan');
    expect(doc.visibility).toBe('private');
    await create(token, 'not shared');
    await share(owner.id, doc.id, ['friend@example.com']);

    const rows = await listSharedWithEmail('friend@example.com');
    expect(rows.map((r) => r.id)).toEqual([doc.id]);
    expect(rows[0].title).toBe('quarterly plan');
    expect(rows[0].owner_username).toBe('shareowner');
  });

  it('matches case-insensitively — the invite can predate the account and its casing', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, 'doc');
    await share(owner.id, doc.id, ['Friend@Example.com']);
    expect((await listSharedWithEmail('friend@example.com')).map((r) => r.id)).toEqual([doc.id]);
    expect((await listSharedWithEmail('FRIEND@example.com')).map((r) => r.id)).toEqual([doc.id]);
  });

  it('never lists the viewer\'s own artifacts, even when their email is on the share list', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, 'mine');
    await share(owner.id, doc.id, ['share-owner@example.com']);
    expect(await listSharedWithEmail('share-owner@example.com', owner.id)).toEqual([]);
  });

  it('unsharing removes the row; deleting the artifact leaves nothing dangling', async () => {
    const { owner, token } = await ownerFixture();
    const a = await create(token, 'a');
    const b = await create(token, 'b');
    await share(owner.id, a.id, ['friend@example.com']);
    await share(owner.id, b.id, ['friend@example.com']);

    await share(owner.id, a.id, []); // full-replace: unshare a
    expect((await listSharedWithEmail('friend@example.com')).map((r) => r.id)).toEqual([b.id]);

    const del = await deleteArtifactRoute(request(`/api/artifacts/${b.id}`, { method: 'DELETE', token: token }), params({ id: b.id }));
    expect(del.status).toBe(200);
    expect(await listSharedWithEmail('friend@example.com')).toEqual([]);
  });
});
