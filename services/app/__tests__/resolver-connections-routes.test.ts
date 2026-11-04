/**
 * A resolver's database connections through the Resolvers panel's HTTP surface: a name bound to a database kind
 * (`postgres`, `mysql`) is listed like a secret, takes a whole validated connection on PUT (sealed like a value, with
 * the declared kind), never comes back in a response, and only the page owner can set it. The stored value is what
 * `caps.db` reads (lib/page-operations database.ts).
 */
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { mountRoutes } from '../server/api';
import { mintAccountToken as mintToken, useAppHarness } from '@/__tests__/harness';
import { identityForUser } from '@/lib/accounts';
import { updateSharingFor } from '@/lib/artifacts';
import { getHtmlBackendVersion } from '@/lib/html-backends';
import { readPinnedBackendSecret } from '@/lib/html-backend-secrets';

vi.mock('@/lib/page-operations', async original => ({ ...await original<typeof import('@/lib/page-operations')>(), compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { rows: String test: String! @auth(role: owner) }', compiled: source, secretBindings: ['API_KEY', 'SHOP', 'WAREHOUSE'], secretHosts: { API_KEY: 'api.example.com', SHOP: 'mysql', WAREHOUSE: 'postgres' } }) }));
useAppHarness();
const app = new Hono();
mountRoutes(app);
const PASSWORD = 'warehouse-pa55word';
const json = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const connection = { host: 'db.example.com', port: 5432, database: 'shop', user: 'reader', password: PASSWORD };

async function publish() {
  const owner = await mintToken('connection-owner');
  const html = '<html><head><link rel="af-resolver" data-af-name="db" href="./db.ts"></head><body>App</body></html>';
  const created = await (await app.request('/api/artifacts', { method: 'POST', headers: json(owner.token), body: JSON.stringify({ html, resolverSources: { db: 'export const secrets={API_KEY:"api.example.com",SHOP:"mysql",WAREHOUSE:"postgres"}' } }) })).json() as { id: string };
  const { resolvers } = await (await app.request(`/api/my/artifacts/${created.id}/resolvers`, { headers: json(owner.token) })).json() as { resolvers: { backendId: string; version: string; secrets: Record<string, string> }[] };
  return { owner, id: created.id, resolver: resolvers[0]!, url: `/api/my/resolvers/${resolvers[0]!.backendId}/${resolvers[0]!.version}/secrets` };
}

it('stores a validated connection for a postgres name without ever returning it', async () => {
  const { owner, id, resolver, url } = await publish();
  expect(resolver.secrets).toEqual({ API_KEY: 'api.example.com', SHOP: 'mysql', WAREHOUSE: 'postgres' });
  const set = await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'WAREHOUSE', connection }) });
  expect(set.status).toBe(200);
  const answer = await set.text();
  expect(answer).not.toContain(PASSWORD);expect(answer).not.toContain('db.example.com');
  expect(JSON.parse(answer)).toEqual({ names: ['WAREHOUSE'] });
  const listed = await (await app.request(`/api/my/artifacts/${id}/resolvers`, { headers: json(owner.token) })).text();
  expect(listed).not.toContain(PASSWORD);expect(JSON.parse(listed).resolvers[0].set).toEqual(['WAREHOUSE']);
  // What caps.db reads: the normalized connection with its declared kind, through the pinned read with its ownership check.
  const backend = (await getHtmlBackendVersion(resolver.backendId, resolver.version))!;
  expect(JSON.parse(await readPinnedBackendSecret(backend, 'WAREHOUSE'))).toEqual({ ...connection, kind: 'postgres', tls: 'verify-full' });
  expect((await app.request(url, { method: 'DELETE', headers: json(owner.token), body: JSON.stringify({ name: 'WAREHOUSE' }) })).status).toBe(200);
  await expect(readPinnedBackendSecret(backend, 'WAREHOUSE')).rejects.toThrow('backend_secret_unavailable');
});

it('stores a mysql name\'s connection with its kind, and refuses a body naming another kind', async () => {
  const { owner, resolver, url } = await publish();
  const shop = { ...connection, port: 3306 };
  expect((await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'SHOP', connection: shop }) })).status).toBe(200);
  const backend = (await getHtmlBackendVersion(resolver.backendId, resolver.version))!;
  expect(JSON.parse(await readPinnedBackendSecret(backend, 'SHOP'))).toEqual({ ...shop, kind: 'mysql', tls: 'verify-full' });
  for (const [name, kind] of [['SHOP', 'postgres'], ['WAREHOUSE', 'mysql'], ['SHOP', 'mssql']]) {
    const response = await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name, connection: { ...shop, kind } }) });
    expect(response.status).toBe(400);expect(await response.json()).toEqual({ error: 'invalid_connection' });
  }
  expect(JSON.parse(await readPinnedBackendSecret(backend, 'SHOP')).kind).toBe('mysql');
});

it('refuses a malformed connection, a plain value for a connection and a connection for a fetch secret', async () => {
  const { owner, url } = await publish();
  for (const bad of [{ ...connection, host: '2130706433' }, { ...connection, host: '127.1' }, { ...connection, port: 22 }, { ...connection, password: '' }, { ...connection, tls: 'prefer' }, { ...connection, extra: true }]) {
    const response = await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'WAREHOUSE', connection: bad }) });
    expect(response.status, JSON.stringify(bad)).toBe(400);expect(await response.json()).toEqual({ error: 'invalid_connection' });
  }
  expect((await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'WAREHOUSE', value: PASSWORD }) })).status).toBe(400);
  expect(await (await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'API_KEY', connection }) })).json()).toEqual({ error: 'invalid_secret' });
  expect(await (await app.request(url, { method: 'PUT', headers: json(owner.token), body: JSON.stringify({ name: 'OTHER', connection }) })).json()).toEqual({ error: 'invalid_secret_binding' });
  expect(await (await app.request(url, { headers: json(owner.token) })).json()).toMatchObject({ names: [] });
});

it('refuses an editor', async () => {
  const { owner, id, url } = await publish();
  const editor = await mintToken('connection-editor');
  await updateSharingFor(identityForUser(owner.userId!, owner.id), id, { shares: [{ email: editor.email!, role: 'editor' }] });
  expect((await app.request(url, { method: 'PUT', headers: json(editor.token), body: JSON.stringify({ name: 'WAREHOUSE', connection }) })).status).toBe(404);
  expect(await (await app.request(url, { headers: json(owner.token) })).json()).toMatchObject({ names: [] });
});
