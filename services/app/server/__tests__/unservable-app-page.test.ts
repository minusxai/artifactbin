/**
 * AN APP PAGE FOR A STORED GRAPH THE CURRENT CODE CANNOT DECODE is never a 500. The shell answers
 * (the same 200 shell with no frame as every unservable document), its head and manifest read no
 * settings out of the broken graph, and the frame's own door (/raw) answers the 410 by name.
 */
import { describe, expect, it } from 'vitest';
import { createAppServer } from '../app';
import { useAppHarness, mintAccountToken as mintToken, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { createUser, ensureUsername } from '@/lib/accounts';

const harness = useAppHarness();
const app = createAppServer({ indexHtml: async () => '<html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Stored = { nodes: Record<string, { children: string[]; parts: string[]; ast?: unknown }> };
const BROKEN: Record<string, (graph: Stored) => unknown> = {
  // graphSource: "Invalid source boundaries" (document-graph.ts, parts must be children + 1)
  'children and parts length mismatch': (graph) => { const root = graph.nodes['$root']!; return { ...graph, nodes: { ...graph.nodes, '$root': { ...root, parts: [...root.parts, 'extra'] } } }; },
  // graphNodes/graphSource: "Invalid document graph" (a child key with no node record)
  'a child with no node record': (graph) => { const root = graph.nodes['$root']!; return { ...graph, nodes: { ...graph.nodes, '$root': { ...root, children: [...root.children, 'ghost'] } } }; },
  'malformed graph JSON': () => ({ schema: 3, kind: 'graph', nodes: 'not-an-object' }),
};

describe.each(Object.entries(BROKEN))('a stored graph with %s', (_name, break_) => {
  it('answers the app page, its head, manifest and frame without a 500', async () => {
    const owner = await ensureUsername(await createUser({ email: `mxmx_test_unservable_page_${Math.abs(_name.length)}@example.com` }));
    const token = await mintToken('unservable-page', owner.id);
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup: '<h1>Fine</h1>', visibility: 'public' } }));
    const id = (await made.json() as { id: string }).id;
    const db = await harness.db();
    const stored = (await db.query<{ document: Stored }>('SELECT document FROM artifacts WHERE id=$1', [id])).rows[0]!.document;
    await db.query('UPDATE artifacts SET document=$2::jsonb, source=NULL WHERE id=$1', [id, JSON.stringify(break_(stored))]);

    for (const path of [`/a/${id}`, `/a/${id}/app/`]) {
      const res = await app.request(path, { headers: { accept: 'text/html' } });
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('rel="manifest"');
      expect(html).not.toContain('mx-document-frame');
    }
    expect((await app.request(`/a/${id}/app/manifest.webmanifest`)).status).toBe(404);
    expect((await app.request(`/a/${id}/app/icon-192.png`)).status).toBe(404);

    for (const response of [await serveRaw(request(`/a/${id}/raw`), params(id)), await pageData(request(`/api/page/artifact/${id}`), params(id))]) {
      expect(response.status, await response.clone().text()).toBe(410);
      expect((await response.json() as { error: string }).error).toBe('unservable_document');
    }
  });
});

describe('a route that throws the refusal', () => {
  it('answers 410 unservable_document, not a bare 500', async () => {
    const { Hono } = await import('hono');
    const { mountRoutes } = await import('../api');
    const { UnservableDocument } = await import('@/lib/artifacts/servable');
    const routes = [{ path: '/api/refuse', dir: '/api/refuse', methods: ['GET'] as const, module: { GET: () => { throw new UnservableDocument(2, 'unreadable'); } } }];
    const api = new Hono();
    mountRoutes(api, routes as unknown as Parameters<typeof mountRoutes>[1]);
    const res = await api.request('/api/refuse');
    expect(res.status).toBe(410);
    expect((await res.json() as { error: string }).error).toBe('unservable_document');
  });
});
