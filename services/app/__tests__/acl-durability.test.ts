/**
 * The ACL must SURVIVE every write path.
 *
 * `visibility` and placement are set on one code path and read on another, so
 * the dangerous failure is silent: a save-less edit, a PUT, or a revert whose
 * UPDATE omits (or resets) those columns would quietly republish a private
 * document — nobody is told, and the owner finds out by being read. These
 * pin the columns across every mutation the document has.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PATCH as patchMineRoute } from '@/app/api/my/artifacts/[id]/route';

import { getArtifactById } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, setUsername } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function fixtures() {
  const owner = await ensureUsername(await createUser({ email: 'acl@example.com' }));
  await setUsername(owner.id, 'aclowner');
  const t = await mintToken('acl');
  await claimToken(owner.id, t.token);
  return { owner, token: t.token };
}

const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; edit_id: string; visibility: string }>;
};

/** A folder of the caller's own to file things under — placement is ids now. */
const folder = async (token: string, title: string): Promise<string> =>
  (await create(token, { format: 'folder', title })).id;

/** The state that must never drift, read straight from the row. */
const stateOf = async (id: string) => {
  const row = await getArtifactById(id);
  return { visibility: row!.visibility, ancestor_ids: row!.ancestor_ids };
};

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('a private document stays private through every write', () => {
  it('survives a save-less markup EDIT — the path an agent uses constantly', async () => {
    const { token } = await fixtures();
    const folderId = await folder(token, 'notes');
    const doc = await create(token, {
      title: 'Secret', markup: '<section><p>alpha text</p></section>', parent_id: folderId,
    });
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [folderId] });

    const edited = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'beta text' } }),
      params({ id: doc.id }),
    );
    expect(edited.status).toBe(200);
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [folderId] });
    // And the door is still shut to a stranger.
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(404);
  });

  it('survives a metadata-only edit (title/theme), which takes a different branch', async () => {
    const { token } = await fixtures();
    const doc = await create(token, { title: 'Secret', markup: '<section><p>alpha</p></section>' });
    const res = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, title: 'Renamed' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect((await stateOf(doc.id)).visibility).toBe('private');
  });

  it('survives a PUT that does not mention visibility or a parent', async () => {
    const { token } = await fixtures();
    const q3 = await folder(token, 'q3');
    const doc = await create(token, { title: 'Secret', markup: '<h1>a</h1>', parent_id: q3 });
    const res = await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<h1>b</h1>' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [q3] });
  });

  it('survives a REVERT to a version archived before the ACL mattered', async () => {
    const { token } = await fixtures();
    const vault = await folder(token, 'vault');
    // v1 public, then flipped private — reverting CONTENT must not revert the ACL.
    const doc = await create(token, { title: 'Secret', markup: '<h1>v1</h1>', visibility: 'public' });
    await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<h1>v2</h1>', visibility: 'private', parent_id: vault } }),
      params({ id: doc.id }),
    );
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [vault] });

    const reverted = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: token, json: { version: 1 } }),
      params({ id: doc.id }),
    );
    expect(reverted.status).toBe(200);
    // Content went back to v1; the ACL did NOT.
    const raw = await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }));
    expect(raw.status).toBe(404);
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [vault] });
  });

  it('survives a move between folders, and a move does not touch visibility', async () => {
    const { owner, token } = await fixtures();
    const moved = await folder(token, 'moved');
    const doc = await create(token, { title: 'Secret', markup: '<h1>a</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const res = await patchMineRoute(
      request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { parent_id: moved } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(await stateOf(doc.id)).toEqual({ visibility: 'private', ancestor_ids: [moved] });
  });
});

describe('a public document stays public through the same writes', () => {
  it('an edit does not silently lock a shared link', async () => {
    const { token } = await fixtures();
    const doc = await create(token, {
      title: 'Open', markup: '<section><p>alpha text</p></section>', visibility: 'public',
    });
    await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'beta text' } }),
      params({ id: doc.id }),
    );
    expect((await stateOf(doc.id)).visibility).toBe('public');
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(200);
  });
});
