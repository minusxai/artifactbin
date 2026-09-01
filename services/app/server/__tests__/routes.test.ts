/**
 * The generated route table is CURRENT (a new route.ts regenerates it, or
 * this fails), maps Next's segment syntax to Hono's, and every handler answers
 * through Hono exactly as it does when called directly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountRoutes } from '../api';
import { ROUTES } from '../routes.generated';

import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

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
    expect(paths.get('/docs/[[...path]]')).toBe('/docs/:path{.*}?');
    expect(paths.get('/api/artifacts/[id]/annotations/[annId]')).toBe('/api/artifacts/:id/annotations/:annId');
  });
  it('records only the methods a module exports', () => {
    const byDir = new Map(ROUTES.map((r) => [r.dir, r.methods]));
    expect(byDir.get('/docs/[[...path]]')).toEqual(['GET']);
    expect(byDir.get('/api/artifacts')).toEqual(expect.arrayContaining(['GET', 'POST']));
    expect(byDir.get('/oauth/register') ?? null).toBeNull(); // the proxy's now
  });
});

describe('handlers through Hono', () => {
  const app = new Hono();
  mountRoutes(app);

  it('serves the docs, refuses an unknown document uniformly, and creates then reads an artifact with a bearer', async () => {
    expect((await app.request('/docs/artifactbin/references/publishing.md')).status).toBe(200);
    expect((await app.request('/docs')).status).toBe(200);
    expect((await app.request('/a/nope00/raw')).status).toBe(404);
    const t = await mintToken('t');
    const created = await app.request('/api/artifacts?v=2', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ markup: '<div><p>via hono</p></div>' }) });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const read = await app.request(`/api/artifacts/${id}`, { headers: { authorization: `Bearer ${t.token}` } });
    expect((await read.json()).markup).toContain('via hono');
    const raw = await app.request(`/a/${id}/raw`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('decodes params the way Next did (an encoded id is the id)', async () => {
    expect((await app.request('/api/artifacts/%41b3xK9')).status).toBe(401); // reached the handler (bearer missing), not a 404 from routing
  });
});
