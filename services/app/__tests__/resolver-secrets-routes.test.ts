/**
 * The Resolvers panel's HTTP surface, through the generated route table: the owner lists a page's resolvers with
 * each declared secret's bound host and Set/Not set state, sets and removes values through `/api/my/resolvers/…`
 * and no response ever carries a value. Editors can neither list nor set.
 */
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { mountRoutes } from '../server/api';
import { mintAccountToken as mintToken, useAppHarness } from '@/__tests__/harness';
import { identityForUser } from '@/lib/accounts';
import { updateSharingFor } from '@/lib/artifacts';

vi.mock('@/lib/page-operations', async original => ({ ...await original<typeof import('@/lib/page-operations')>(), compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { value: String test: String! @auth(role: owner) }', compiled: source, secretBindings: ['TOKEN'], secretHosts: { TOKEN: 'api.example.com' } }) }));
useAppHarness();
const app = new Hono();
mountRoutes(app);
const VALUE = 'private-panel-value';
const json = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function publish() {
  const owner = await mintToken('resolver-owner');
  const html = '<html><head><link rel="af-resolver" data-af-name="db" href="./db.ts"></head><body>App</body></html>';
  const created = await (await app.request('/api/artifacts', { method: 'POST', headers: json(owner.token), body: JSON.stringify({ html, resolverSources: { db: 'export const secrets={TOKEN:"api.example.com"}' } }) })).json() as { id: string };
  return { owner, id: created.id };
}

it('lists the page resolvers for the owner, and sets and removes a value through the resolvers address without returning it', async () => {
  const { owner, id } = await publish();
  const listed = await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(owner.token) });
  expect(listed.status).toBe(200);
  const before = await listed.json() as { revision: string; resolvers: { backendId: string; version: string }[] };
  expect(before.revision).toEqual(expect.any(String));
  expect(before.resolvers).toEqual([{ name: 'db', backendId: expect.any(String), version: expect.any(String), test: true, secrets: { TOKEN: 'api.example.com' }, set: [] }]);
  const { backendId, version } = before.resolvers[0]!;
  const alias = `/api/my/resolvers/${backendId}/${version}/secrets`;
  const set = await app.request(alias, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'TOKEN', value: VALUE }) });
  expect(set.status).toBe(200);
  expect(await set.text()).not.toContain(VALUE);
  const after = await (await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(owner.token) })).text();
  expect(after).not.toContain(VALUE);
  expect(JSON.parse(after).resolvers[0].set).toEqual(['TOKEN']);
  expect(await (await app.request(alias, { headers: json(owner.token) })).json()).toEqual({ names: ['TOKEN'], secrets: { TOKEN: 'api.example.com' }, test: true });
  // The removed backends address is not routed.
  expect((await app.request(`/api/my/backends/${backendId}/${version}/secrets`, { headers: json(owner.token) })).status).toBe(404);
  const removed = await app.request(alias, { method: 'DELETE', headers: json(owner.token), body: JSON.stringify({ name: 'TOKEN' }) });
  expect(await removed.json()).toEqual({ names: [] });
});

it('refuses an editor: no listing, no setting and no removing of the owner secrets', async () => {
  const { owner, id } = await publish();
  const editor = await mintToken('resolver-editor');
  await updateSharingFor(identityForUser(owner.userId!, owner.id), id, { shares: [{ email: editor.email!, role: 'editor' }] });
  const { resolvers } = await (await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(owner.token) })).json() as { resolvers: { backendId: string; version: string }[] };
  const { backendId, version } = resolvers[0]!;
  await app.request(`/api/my/resolvers/${backendId}/${version}/secrets`, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'TOKEN', value: VALUE }) });
  expect((await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(editor.token) })).status).toBe(404);
  {
    const url = `/api/my/resolvers/${backendId}/${version}/secrets`;
    expect((await app.request(url, { method: 'PUT', headers: json(editor.token), body: JSON.stringify({ name: 'TOKEN', value: 'editor-value' }) })).status).toBe(404);
    expect((await app.request(url, { method: 'DELETE', headers: json(editor.token), body: JSON.stringify({ name: 'TOKEN' }) })).status).toBe(404);
    expect((await app.request(url, { headers: json(editor.token) })).status).toBe(404);
  }
  expect((await (await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(owner.token) })).json()).resolvers[0].set).toEqual(['TOKEN']);
  expect((await app.request(`/api/my/artifacts/${id}/resolvers`)).status).toBe(401);
});
