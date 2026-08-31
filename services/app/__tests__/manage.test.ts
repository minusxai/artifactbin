/**
 * Management surface: token listing/revocation (dashboard), artifact deletion,
 * version listing, and revert-to-version.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import {
  DELETE as deleteArtifactRoute,
  GET as getArtifactRoute,
  PUT as putArtifact,
} from '@/app/api/artifacts/[id]/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { isVersionNotArchived, listVersionsFor, revertArtifactFor } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { createUser, listAccountTokenRows, revokeUserToken } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function create(token: string, html: string, title = 'x') {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title, markup: html } }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; url: string }>;
}

async function put(token: string, id: string, html: string) {
  const res = await putArtifact(
    request(`/api/artifacts/${id}`, { method: 'PUT', token: token, json: { markup: html } }),
    params({ id }),
  );
  expect(res.status).toBe(200);
  return res.json() as Promise<{ version: number }>;
}

describe('token management', () => {
  it('lists a user’s tokens with artifact counts and revoked state', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const a = await mintToken('laptop', user.id);
    const b = await mintToken('desktop', user.id);
    await mintToken('someone-elses', null);
    await create(a.token, '<p>1</p>');
    await create(a.token, '<p>2</p>');

    const tokens = await listAccountTokenRows(user.id);
    expect(tokens.map((t) => t.name).sort()).toEqual(['desktop', 'laptop']);
    const laptop = tokens.find((t) => t.name === 'laptop');
    expect(laptop).toMatchObject({ id: a.id, artifacts: 2, revoked_at: null });
    expect(tokens.find((t) => t.name === 'desktop')).toMatchObject({ id: b.id, artifacts: 0 });
  });

  it('revokes only your own live tokens; revoked tokens stop authenticating', async () => {
    const alice = await createUser({ email: 'a@x.com' });
    const bob = await createUser({ email: 'b@x.com' });
    const t = await mintToken('laptop', alice.id);

    expect(await revokeUserToken(bob.id, t.id)).toBe(false);
    expect(await revokeUserToken(alice.id, t.id)).toBe(true);
    expect(await revokeUserToken(alice.id, t.id)).toBe(false); // already revoked

    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>x</p>' } }),
    );
    expect(res.status).toBe(401);

    // Still listed (with revoked_at set) so the dashboard shows history.
    const tokens = await listAccountTokenRows(alice.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revoked_at).not.toBeNull();
  });
});

describe('artifact deletion', () => {
  it('deletes an artifact and its version history; the public link dies', async () => {
    const t = await mintToken('t');
    const art = await create(t.token, '<h1>v1</h1>');
    await put(t.token, art.id, '<h1>v2</h1>');

    const res = await deleteArtifactRoute(
      request(`/api/artifacts/${art.id}`, { method: 'DELETE', token: t.token }),
      params({ id: art.id }),
    );
    expect(res.status).toBe(200);

    expect((await getArtifactRoute(request(`/api/artifacts/${art.id}`, { token: t.token }), params({ id: art.id }))).status).toBe(404);
    expect((await serveArtifact(request(`/a/${art.id}/raw`), params({ id: art.id }))).status).toBe(404);

    const db = await harness.db();
    const versions = await db.query('SELECT 1 FROM artifact_versions WHERE artifact_id = $1', [art.id]);
    expect(versions.rows).toHaveLength(0);
  });

  it("cannot delete another token's artifact (uniform 404)", async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const art = await create(a.token, '<p>x</p>');
    const res = await deleteArtifactRoute(
      request(`/api/artifacts/${art.id}`, { method: 'DELETE', token: b.token }),
      params({ id: art.id }),
    );
    expect(res.status).toBe(404);
  });
});

describe('versions + revert', () => {
  it('lists archived versions (no content) newest first', async () => {
    const t = await mintToken('t');
    const art = await create(t.token, '<h1>v1</h1>', 'doc');
    await put(t.token, art.id, '<h1>v2</h1>');
    await put(t.token, art.id, '<h1>v3</h1>');

    const res = await listVersionsRoute(request(`/api/artifacts/${art.id}/versions`, { token: t.token }), params({ id: art.id }));
    expect(res.status).toBe(200);
    const { versions } = await res.json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].content).toBeUndefined();
  });

  it('reverts to an archived version as a NEW version; the link stays stable', async () => {
    const t = await mintToken('t');
    const art = await create(t.token, '<h1>v1</h1>');
    await put(t.token, art.id, '<h1>v2</h1>');

    const res = await revertRoute(
      request(`/api/artifacts/${art.id}/revert`, { method: 'POST', token: t.token, json: { version: 1 } }),
      params({ id: art.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(3);
    // One identifier, and reverting does not mint a new one: the share URL
    // an agent already handed out keeps resolving to the reverted document.
    expect(body.id).toBe(art.id);
    expect(body.url).toBe(art.url);

    const read = await getArtifactRoute(request(`/api/artifacts/${art.id}`, { token: t.token }), params({ id: art.id }));
    expect((await read.json()).markup).toBe('<h1>v1</h1>');

    // v2 was archived by the revert, so both prior states remain recoverable.
    const versions = await (
      await listVersionsRoute(request(`/api/artifacts/${art.id}/versions`, { token: t.token }), params({ id: art.id }))
    ).json();
    expect(versions.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('refuses a version it cannot restore WITHOUT pretending the artifact is missing', async () => {
    const t = await mintToken('t');
    const art = await create(t.token, '<h1>v1</h1>');
    const res = await revertRoute(
      request(`/api/artifacts/${art.id}/revert`, { method: 'POST', token: t.token, json: { version: 7 } }),
      params({ id: art.id }),
    );
    // Ownership is already proved here, so a bare 404 would only confuse:
    // it is the answer for "no such artifact". 404 stays reserved for that.
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('version_not_archived');
  });

  it('400s a missing/invalid version field', async () => {
    const t = await mintToken('t');
    const art = await create(t.token, '<h1>v1</h1>');
    const res = await revertRoute(
      request(`/api/artifacts/${art.id}/revert`, { method: 'POST', token: t.token, json: {} }),
      params({ id: art.id }),
    );
    expect(res.status).toBe(400);
  });
});

describe('user-scoped versions + revert (dashboard)', () => {
  it('lists and reverts across any of the user’s tokens', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const art = await create(t.token, '<h1>v1</h1>');
    await put(t.token, art.id, '<h1>v2</h1>');

    const versions = await listVersionsFor({ tokenId: '', userId: user.id }, art.id);
    expect(versions?.map((v) => v.version)).toEqual([1]);

    const reverted = await revertArtifactFor({ tokenId: '', userId: user.id }, art.id, 1);
    expect(isVersionNotArchived(reverted)).toBe(false);
    if (isVersionNotArchived(reverted)) return;
    expect(reverted?.version).toBe(3);
    // A document's truth is `source`; markup rows keep `content` empty.
    expect(reverted?.source).toBe('<h1>v1</h1>');
  });

  it("returns null for another user's artifact", async () => {
    const alice = await createUser({ email: 'a@x.com' });
    const mallory = await createUser({ email: 'm@x.com' });
    const t = await mintToken('laptop', alice.id);
    const art = await create(t.token, '<h1>v1</h1>');
    await put(t.token, art.id, '<h1>v2</h1>');

    expect(await listVersionsFor({ tokenId: '', userId: mallory.id }, art.id)).toBeNull();
    expect(await revertArtifactFor({ tokenId: '', userId: mallory.id }, art.id, 1)).toBeNull();
  });
});
