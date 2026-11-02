/**
 * The generated route table is CURRENT (a new route.ts regenerates it, or
 * this fails), maps the directory segment syntax to Hono's, and every handler
 * answers through Hono exactly as it does when called directly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { mountRoutes } from '../api';
import { createAppServer } from '../app';
import { ROUTES } from '../routes.generated';
import { exportedMethods } from '../../scripts/generate-routes.mjs';

import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {createGroup} from '@/lib/groups';
import {admitGroupMember} from '@/__tests__/harness';
import { useAppHarness } from '@/__tests__/harness';

vi.mock('@/lib/page-operations', async original => ({ ...await original<typeof import('@/lib/page-operations')>(), compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { value: String }', compiled: source, secretBindings: ['TOKEN'] }) }));
const harness = useAppHarness();

describe('the route table', () => {
  it('is generated from the filesystem and up to date', () => {
    const before = readFileSync('server/routes.generated.ts', 'utf8');
    execFileSync('node', ['scripts/generate-routes.mjs'], { stdio: 'ignore' });
    expect(readFileSync('server/routes.generated.ts', 'utf8')).toBe(before);
    expect(ROUTES.length).toBeGreaterThanOrEqual(40);
  });
  it('maps [id], [...rest] and [[...rest]] to Hono params', () => {
    const paths = new Map(ROUTES.map((r) => [r.dir, r.path]));
    expect(paths.get('/api/artifacts/[id]')).toBe('/api/artifacts/:id');
    expect(paths.get('/tiles/[...tile]')).toBe('/tiles/:tile{.+}');
    expect(paths.has('/docs/[[...path]]')).toBe(false);
    expect(paths.has('/mcp')).toBe(false);
    expect(paths.get('/api/artifacts/[id]/annotations/[annId]')).toBe('/api/artifacts/:id/annotations/:annId');
  });
  it('records only the methods a module exports', () => {
    const byDir = new Map(ROUTES.map((r) => [r.dir, r.methods]));
    expect(byDir.get('/llms.txt')).toEqual(['GET']);
    expect(byDir.get('/api/artifacts')).toEqual(expect.arrayContaining(['GET', 'POST']));
    expect(byDir.get('/oauth/register') ?? null).toBeNull(); // the proxy's
    expect(byDir.get('/api/my/backends/[id]/[version]/secrets')).toEqual(['GET', 'PUT', 'DELETE']);
    expect(byDir.get('/api/my/resolvers/[id]/[version]/secrets')).toEqual(['GET', 'PUT', 'DELETE']);
  });
  it('detects every form of exported method, and nothing else', () => {
    expect(exportedMethods('const handle=()=>0;\nexport const GET=handle,PUT=handle,DELETE=handle;')).toEqual(['GET', 'PUT', 'DELETE']);
    expect(exportedMethods('export async function POST(){}\nexport function HEAD(){}\nexport const PATCH = (r) => r;')).toEqual(['POST', 'PATCH', 'HEAD']);
    expect(exportedMethods("export {notFound as POST, notFound as GET} from '@/lib/http';\nexport {OPTIONS} from './x';")).toEqual(['GET', 'POST', 'OPTIONS']);
    expect(exportedMethods("const GET=1;\n// export const PUT=1\nconst s='export const DELETE=1';\nexport {GET as PATCH};\nexport const runtime='node';")).toEqual(['PATCH']);
  });
});

describe('handlers through Hono', () => {
  const app = new Hono();
  mountRoutes(app);

  // The retired `/docs` and `/mcp` addresses are docs-human.test.ts's subject — it is
  // their dedicated owner and answers them for browsers as well as machines.
  it('refuses an unknown document uniformly, and creates then reads an artifact with a bearer', async () => {
    expect(await (await app.request('/llms.txt')).text()).toContain('/llms/');
    expect((await app.request('/a/nope00/raw')).status).toBe(404);
    const t = await mintToken('t');
    const created = await app.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ html: '<div><p>via hono</p></div>', visibility: 'public' }) });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const read = await app.request(`/api/artifacts/${id}`, { headers: { authorization: `Bearer ${t.token}` } });
    expect((await read.json()).html).toContain('via hono');
    const raw = await app.request(`/a/${id}/raw`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('dispatches viewer self-leave to the static me route before the member ID route',async()=>{
    const owner=await mintToken('route-owner'),viewer=await mintToken('route-viewer');
    const group=await createGroup(owner.userId!,{handle:'static_leave',name:'Leave'});
    await admitGroupMember(owner.userId!,group.id,viewer.userId!,'viewer');
    const response=await app.request(`/api/groups/${group.id}/members/me`,{method:'DELETE',headers:{authorization:`Bearer ${viewer.token}`}});
    expect(response.status).toBe(200);
  });
  it('routes PUT and DELETE on backend secrets to the handler: the owner sets and revokes, the value never returns', async () => {
    const owner = await mintToken('secret-routes');
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` };
    const html = '<html><head><link rel="af-backend" data-af-name="db" href="./db.ts"></head><body>App</body></html>';
    const created = await (await app.request('/api/artifacts', { method: 'POST', headers: auth, body: JSON.stringify({ html, backendSources: { db: 'credential' } }) })).json();
    const db = await harness.db();
    const link = (await db.query<{ meta: { htmlLinks: { backendId: string; version: string }[] } }>('SELECT meta FROM artifacts WHERE id=$1', [created.id])).rows[0]!.meta.htmlLinks[0]!;
    const url = `/api/my/backends/${link.backendId}/${link.version}/secrets`;
    const set = await app.request(url, { method: 'PUT', headers: auth, body: JSON.stringify({ name: 'TOKEN', value: 'private-route-value' }) });
    expect(set.status).toBe(200);
    const setBody = await set.text();
    expect(JSON.parse(setBody)).toEqual({ names: ['TOKEN'] });
    expect(setBody).not.toContain('private-route-value');
    expect(await (await app.request(url, { headers: auth })).json()).toEqual({ names: ['TOKEN'], secrets: {}, test: false, api: 1 });
    const revoked = await app.request(url, { method: 'DELETE', headers: auth, body: JSON.stringify({ name: 'TOKEN' }) });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ names: [] });
  });
  it('decodes params before the handler sees them (an encoded id is the id)', async () => {
    expect((await app.request('/api/artifacts/%41b3xK9')).status).toBe(401); // reached the handler (bearer missing), not a 404 from routing
  });
});

// Exercise the full server: a missing explicit non-API route can reach the SPA shell.
it('retired authoring routes preserve their HTTP refusal independently of credentials', async () => {
  const app = createAppServer({indexHtml: async () => '<main>SPA shell</main>'});
  const actor = await mintToken('retired-route');
  const paths = [
    ['/a/abc123/draft-preview', ['GET', 'POST']],
    ['/a/abc123/viewer', ['GET']],
    ...['/api/artifacts', '/api/my/artifacts'].flatMap(base =>
      ['edits', 'prepare'].map(tail => [base + '/abc123/' + tail, ['POST']])),
  ] as [string, string[]][];
  for (const [path, methods] of paths) for (const method of methods) {
    for (const authorization of [undefined, 'Bearer invalid', `Bearer ${actor.token}`]) {
      const response = await app.request(path, {method, headers: {
        accept: 'text/html', ...(authorization ? {authorization} : {}),
      }});
      expect(response.status, method + ' ' + path).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('cache-control')).toBeNull();
      expect(await response.text()).toBe('{"error":"not_found"}');
    }
  }
});
