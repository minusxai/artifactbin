import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { createUser, claimToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { getArtifactById } from '@/lib/artifacts';
import { framedDocumentSrc } from '@/lib/serving/artifact-page';
import { pagesSiteFor } from '@/lib/http/pages-origin';
import { attachActor } from '@artifactbin/utils';

useAppHarness();

it('publishes a context reference without granting readers access to its private document', async () => {
  const user = await createUser({ email: 'mxmx_test_context@example.com' });
  const owner = await mintToken('context-owner', user.id);
    await claimToken(user.id, owner.token);
  const create = (token: string, markup: string, visibility: string) => createArtifact(request('/api/artifacts', {
    method: 'POST', token, json: { markup, visibility },
  }));
  const doc = await create(owner.token, '<h1>Private methodology</h1>', 'private');
  expect(doc.status, await doc.clone().text()).toBe(201);
  const { id: contextId } = await doc.json() as { id: string };
  const markup = `<Helmet><Context src="ref:${contextId}" /></Helmet><h1>Public dashboard</h1>`;
  const dashboard = await create(owner.token, markup, 'public');
  expect(dashboard.status, await dashboard.clone().text()).toBe(201);
  const { id } = await dashboard.json() as { id: string };
  const row = await getArtifactById(id);
  expect(row?.meta).toMatchObject({ refs: [{ id: contextId, kind: 'document' }] });
  expect(row?.source).toContain(`ref:${contextId}`);
  const site = pagesSiteFor('pages.example.test', 'https://app.example.test')!;
  const ownerRequest = request(`/api/page/frame/${contextId}`);
  attachActor(ownerRequest, { credential: 'session', userId: user.id, tokenId: owner.id });
  expect(await framedDocumentSrc(ownerRequest, contextId, site)).not.toBeNull();
  expect(await framedDocumentSrc(request(`/api/page/frame/${contextId}`), contextId, site)).toBeNull();
  const stranger = await mintToken('context-stranger');
  const refused = await create(stranger.token, markup, 'public');
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain('does not resolve');
});
