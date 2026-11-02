import { expect, it } from 'vitest';
import { nativeHtml } from './native-html-fixture';
import { POST as publish } from '@/app/api/artifacts/route';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { POST as start } from '@/app/api/start/route';
import { mintToken, createUser } from '@/lib/accounts';
import { listArtifactsByUser } from '@/lib/workspace';
import { useAppHarness, request } from './harness';
const harness = useAppHarness();
it('legacy anonymous credentials cannot publish or create ownership', async () => {
  const token = await mintToken('legacy', null);
  const response = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { html: nativeHtml('<h1>Refused</h1>') } }));
  expect(response.status).toBe(401);
  expect((await (await harness.db()).query('SELECT 1 FROM artifacts')).rows).toHaveLength(0);
});
it.each([internalMint, start])('refuses anonymous connection requests repeatedly', async route => {
  for (let i = 0; i < 15; i++) expect((await route(request('/api/start', { method: 'POST' }))).status).toBe(401);
});
it('lists publications across tokens minted by the same account', async () => {
  const user = await createUser({ email: 'mxmx_test_listing@example.test' });
  for (const title of ['laptop', 'desktop']) {
    const token = await mintToken(title, user.id);
    const response = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { title, html: nativeHtml(`<h1>${title}</h1>`) } }));
    expect(response.status).toBe(201);
  }
  expect((await listArtifactsByUser(user.id)).map(row => row.title).sort()).toEqual(['desktop', 'laptop']);
});
