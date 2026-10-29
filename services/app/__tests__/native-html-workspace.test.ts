import { expect, it } from 'vitest';
import { DELETE as deleteArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as profilePage } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { claimToken } from '@/lib/authentication';
import { createUser, ensureUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { mintAccountToken } from './harness';
import { request, useAppHarness } from './harness';

useAppHarness();
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

it('lists only live public HTML pages, keeping private, deleted, and legacy markup rows out', async () => {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_native_profile@example.com' }));
  const account = await mintAccountToken('native-profile', owner.id);
  await claimToken(owner.id, account.token);
  const create = async (html: string, visibility: 'public' | 'private') => {
    const response = await createArtifactRoute(request('/api/artifacts', {
      method: 'POST', token: account.token, json: { html, visibility },
    }));
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json() as Promise<{ id: string }>;
  };
  const visible = await create('<!doctype html><html><body><h1>Visible</h1></body></html>', 'public');
  const privatePage = await create('<!doctype html><html><body><h1>Private</h1></body></html>', 'private');
  const deleted = await create('<!doctype html><html><body><h1>Deleted</h1></body></html>', 'public');
  const legacy = await create('<!doctype html><html><body><h1>Legacy</h1></body></html>', 'public');
  const deletedResponse = await deleteArtifactRoute(
    request(`/api/artifacts/${deleted.id}`, { method: 'DELETE', token: account.token }), params({ id: deleted.id }),
  );
  expect(deletedResponse.status).toBe(200);

  // Simulate a stored pre-migration row to pin the page-format gate.
  const db = await getDb();
  await db.query("UPDATE artifacts SET format = 'markup' WHERE id = $1", [legacy.id]);

  const h = owner.username!;
  const profile = await (await profilePage(request(`/api/page/profile/@${h}`), params({ user: `@${h}` }))).json();
  expect(profile.files.map((file: { id: string }) => file.id)).toEqual([visible.id]);
  for (const id of [privatePage.id, deleted.id]) {
    expect((await profilePage(request(`/api/page/profile/@${h}/${id}-hidden`), params({ user: `@${h}`, path: `${id}-hidden` }))).status).toBe(404);
  }
});
