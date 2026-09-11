import {observedRequest} from '@/__tests__/conditional-request';
/**
 * API contract tests — real route handlers, in-memory PGLite (NODE_ENV=test ⇒
 * no data dir), no HTTP server. One PGLite instance for the file; rows are
 * wiped between tests (fresh WASM boot per test would be needlessly slow).
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listArtifactsRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';
import {GET as getLlmsTxt} from '@/app/llms.txt/route';
// Minting and revoking are the APP's own routes (app/api/tokens/**) — the real
// handlers, driven in-process exactly as the proxy forwards them.
import { DELETE as revokeTokenRoute } from '@/app/api/tokens/[id]/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';
const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function mint(name?: string): Promise<{ id: string; token: string }> {
  const res = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name }, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
  expect(res.status).toBe(201);
  return res.json();
}

async function create(token: string, html = '<h1>hi</h1>', title = 'hello') {
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { title, markup: html } }),
  );
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; url: string; version: number }>;
}

describe('token minting', () => {
  it('mints with the shared secret; token is mx_-prefixed and shown once', async () => {
    const { id, token } = await mint('dev');
    expect(id).toMatch(/^tok_/);
    expect(token).toMatch(/^mx_[A-Za-z0-9_-]{40,50}$/);
  });

  it('answers uniform 404 for a wrong or missing secret', async () => {
    for (const secret of ['nope', undefined]) {
      const res = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: {}, headers: { ...(secret ? { 'x-shared-secret': secret } : {}) } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('revoked tokens stop authenticating (uniform 401)', async () => {
    const { id, token } = await mint();
    await create(token);
    const revoke = await revokeTokenRoute(
      request(`/api/tokens/${id}`, { method: 'DELETE', headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }),
      params({ id }),
    );
    expect(revoke.status).toBe(204);
    const res = await listArtifactsRoute(request('/api/artifacts', { token: token }));
    expect(res.status).toBe(401);
  });
});

describe('artifact CRUD', () => {
  it('uniform 401 for missing, malformed, and unknown bearers', async () => {
    for (const token of [undefined, 'garbage', 'mx_' + 'a'.repeat(43)]) {
      const res = await listArtifactsRoute(request('/api/artifacts', { token: token }));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    }
  });

  it('creates and reads back an artifact', async () => {
    const { token } = await mint();
    const created = await create(token, '<h1 id="head">report</h1>', 'Q3');
    expect(created.url).toBe(`${BASE}/a/${created.id}`);
    expect(created).not.toHaveProperty('slug');
    expect(created.version).toBe(1);

    const res = await getArtifactRoute(
      request(`/api/artifacts/${created.id}`, { token: token }),
      params({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markup).toBe('<h1 id="head">report</h1>');
    expect(body.title).toBe('Q3');
    expect(body.token_id).toBeUndefined();
  });

  it('rejects a missing html/markup field with 400', async () => {
    const { token } = await mint();
    const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title: 'x' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'one_of_markup_dataset_viz_image_pdf' });
  });

  it('rejects oversized html with 413', async () => {
    const { token } = await mint();
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { markup: 'x'.repeat(2_000_001) } }),
    );
    expect(res.status).toBe(413);
  });

  it('PUT bumps the version, archives the old state, and keeps the id/url stable', async () => {
    const { token } = await mint();
    const created = await create(token, '<h1 id="head">v1</h1>');
    const res = await putArtifact(
      await observedRequest(`/api/artifacts/${created.id}`, { method: 'PUT', token: token, json: { markup: '<h1 id="head">v2</h1>' } }),
      params({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.version).toBe(2);
    // One identifier, and the share URL never moves across a replace.
    expect(updated.id).toBe(created.id);
    expect(updated.url).toBe(created.url);
    expect(updated).not.toHaveProperty('slug');

    // A document's truth is `source` (markup rows keep `content` empty).
    const db = await harness.db();
    const versions = await db.query<{ version: number; source: string }>(
      'SELECT version, source FROM artifact_versions WHERE artifact_id = $1',
      [created.id],
    );
    expect(versions.rows).toEqual([{ version: 1, source: '<h1 id="head">v1</h1>' }]);

    const read = await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: token }), params({ id: created.id }));
    expect((await read.json()).markup).toBe('<h1 id="head">v2</h1>');
  });

  it("answers uniform 404 for another token's artifact id", async () => {
    const a = await mint('a');
    const b = await mint('b');
    const created = await create(a.token);
    for (const handler of [
      () => getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: b.token }), params({ id: created.id })),
      async () =>
        putArtifact(
          await observedRequest(`/api/artifacts/${created.id}`, { method: 'PUT', token: b.token, json: { markup: '<p>x</p>' } }),
          params({ id: created.id }),
        ),
    ]) {
      const res = await handler();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('lists only own artifacts, newest first, without content', async () => {
    const a = await mint('a');
    const b = await mint('b');
    await create(a.token, '<p>1</p>', 'first');
    // One tick between creates: same-microsecond CURRENT_TIMESTAMPs make the
    // "newest first" ORDER BY ambiguous (observed flake under a busy suite).
    await new Promise((r) => setTimeout(r, 2));
    await create(a.token, '<p>2</p>', 'second');
    await create(b.token, '<p>3</p>', 'other');

    const res = await listArtifactsRoute(request('/api/artifacts', { token: a.token }));
    const { artifacts } = await res.json();
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((x: { title: string }) => x.title)).toEqual(['second', 'first']);
    expect(artifacts[0].content).toBeUndefined();
    expect(artifacts[0].markup).toBeUndefined();
  });
});

describe('public serving', () => {
  it('serves the document with the strict CSP headers', async () => {
    const { token } = await mint();
    const created = await create(token, '<h1>public</h1>');
    const res = await serveArtifact(request(`/a/${created.id}/raw`), params({ id: created.id }));
    expect(res.status).toBe(200);
    // The SSR'd document, not the source (elements carry their AST stamps) —
    // see __tests__/raw-document.test.ts for the document's shape.
    expect(await res.text()).toMatch(/<h1[^>]*>public<\/h1>/);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('404s unknown and malformed ids', async () => {
    // Both arms, indistinguishable: 'zzzzzz' is VALID id syntax that names no
    // row; the rest fail the syntax gate (too short, underscore, hyphen, too
    // long, bad charset). Uppercase alone is valid now, so it is not a fixture.
    for (const id of ['zzzzzz', 'abc12', 'art_abc123', 'abc-12', 'zzzzzzzzzzzzzzzzzzz', 'UPPER-not_valid!']) {
      const res = await serveArtifact(request(`/a/${id}/raw`), params({ id }));
      expect(res.status).toBe(404);
    }
  });
});

describe('CLI discovery',()=>{
 it('names local help, browser setup and a versioned downloadable bundle',async()=>{
  const response=await getLlmsTxt(request('/llms.txt'));const text=await response.text();
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/plain');
  expect(text).toContain('afbin setup --server http://localhost:3000');
  expect(text).toContain('afbin help');expect(text).toContain('/releases/download/afbin-v');
  expect(text).not.toContain('/docs/');expect(Buffer.byteLength(text)).toBeLessThan(1024);
 });
});
