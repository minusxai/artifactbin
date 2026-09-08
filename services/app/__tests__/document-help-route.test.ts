import {PUBLIC_BASE_URL} from '@/lib/config';
import {proxyRequest} from '@/server/__tests__/proxy-request';
/**
 * DISCOVER: the REAL reader route serves the help pointer — as an HTTP `Link: <…/docs>; rel="help"` header (for
 * agents that read headers or strip HTML) and in <head> — built on the request's own base URL. Seeded RED.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { createArtifact } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { createUser, ensureUsername } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /a/:id (the document itself)', () => {
  it('carries Link: <base>/docs; rel="help" and the head pointer, on the request base', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`), params(row.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${BASE}/docs>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/docs" title="Agents: read this first to edit any artifact here">`);
    expect(html).toContain(`tokens at ${BASE}/tokens/new`);
  });
  it('follows x-forwarded-proto/host like every other absolute URL the app emits', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artefactbin.dev' } }), params(row.id));
    expect(res.headers.get('link')).toBe('<https://artefactbin.dev/docs>; rel="help"');
  });
  it('carries the same header and head pointer at an owned artifact pretty URL', async () => {
    const owner = await ensureUsername(await createUser({ email: 'pretty-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', content: '', source: '<div>pretty</div>', meta: {}, title: 'Pretty help', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<html><head></head><body><div id="root"></div></body></html>' });
    const res = await proxyRequest(app,`${BASE}/@${owner.username}/${row.id}-pretty-help`);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${PUBLIC_BASE_URL}/docs>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${PUBLIC_BASE_URL}/docs" title="Agents: read this first to edit any artifact here">`);
    expect(html).toContain(`read ${PUBLIC_BASE_URL}/docs — tokens at ${PUBLIC_BASE_URL}/tokens/new`);
  });
});
