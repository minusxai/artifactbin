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
import { GET as docsRoute } from '@/app/docs/[[...path]]/route';

const docsPath = (p: string) => docsRoute(request(`/docs${p ? '/' + p : ''}`), { params: Promise.resolve({ path: p }) });
const getDoc = (_r: Request) => docsPath('artifactbin/references/publishing.md');
import { GET as getLlmsTxt } from '@/app/llms.txt/route';
const docsIndexRoute = (_r: Request) => docsPath('');
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
    const created = await create(token, '<h1>report</h1>', 'Q3');
    expect(created.url).toBe(`${BASE}/a/${created.id}`);
    expect(created).not.toHaveProperty('slug');
    expect(created.version).toBe(1);

    const res = await getArtifactRoute(
      request(`/api/artifacts/${created.id}`, { token: token }),
      params({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markup).toBe('<h1>report</h1>');
    expect(body.title).toBe('Q3');
    expect(body.token_id).toBeUndefined();
  });

  it('rejects a missing html/markup field with 400', async () => {
    const { token } = await mint();
    const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title: 'x' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'one_of_markup_dataset_viz_image' });
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
    const created = await create(token, '<h1>v1</h1>');
    const res = await putArtifact(
      request(`/api/artifacts/${created.id}`, { method: 'PUT', token: token, json: { markup: '<h1>v2</h1>' } }),
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
    expect(versions.rows).toEqual([{ version: 1, source: '<h1>v1</h1>' }]);

    const read = await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: token }), params({ id: created.id }));
    expect((await read.json()).markup).toBe('<h1>v2</h1>');
  });

  it("answers uniform 404 for another token's artifact id", async () => {
    const a = await mint('a');
    const b = await mint('b');
    const created = await create(a.token);
    for (const handler of [
      () => getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: b.token }), params({ id: created.id })),
      () =>
        putArtifact(
          request(`/api/artifacts/${created.id}`, { method: 'PUT', token: b.token, json: { markup: '<p>x</p>' } }),
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

/**
 * `/llms.txt` is where an agent looks when nobody told it where the docs are.
 * It is the llmstxt.org shape — a SMALL index of links — and deliberately not
 * a copy of the protocol doc: an agent that fetched `/llms.txt` and then
 * `/docs/llm` was reading the same 30 KB twice (measured on the dashboard
 * task), and two large copies of one doc is the worst of both worlds.
 */
describe('/llms.txt', () => {
  it('serves the small docs index — the same bytes /docs serves an agent', async () => {
    const [a, b, full] = await Promise.all([
      getLlmsTxt(request('/llms.txt')).then((r) => r.text()),
      docsIndexRoute(request('/docs')).then((r: Response) => r.text()),
      getDoc(request('/docs/artifactbin/references/publishing.md')).then((r: Response) => r.text()),
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(full);
    expect(Buffer.byteLength(a)).toBeLessThan(6200);
    expect(a).toContain(`${BASE}/docs/artifactbin/references/publishing.md`);
  });

  it('answers as markdown, uncached', async () => {
    const res = await getLlmsTxt(request('/llms.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/markdown|text\/plain/);
  });
});

describe('skill doc', () => {
  it('serves markdown with absolute URLs baked in', async () => {
    const res = await getDoc(request('/docs/llm'));
    expect(res.status).toBe(200);
    // text/plain, not text/markdown — see MARKDOWN_CONTENT_TYPE: agents' web
    // readers reject the markdown type, and this doc exists for agents.
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain(`POST ${BASE}/api/artifacts`);
    expect(text).toContain('Authorization: Bearer mx_');
  });

  /**
   * The doc IS the agent's only spec — an example it teaches that the API
   * rejects sends the agent into a 400 loop it cannot escape. Every ```json
   * block in the doc is therefore executed against the real create route.
   */
  it('every ```json example it teaches is a payload the API accepts', async () => {
    const { token } = await mint('doc-examples');
    const doc = await (await docsPath('artifactbin/references/publishing-datasets.md')).text();
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    // `viz` is the one tier whose shape (description/engine/bindings[]/
    // template{}) prose cannot convey, so the doc must carry a working
    // example. The others are fully determined by the text around them.
    expect(blocks.some((b) => b.includes('"viz"'))).toBe(true);
    for (const block of blocks) {
      const body = JSON.parse(block) as Record<string, unknown>;
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
      expect(
        res.status,
        `doc example rejected: ${JSON.stringify(await res.clone().json())}\n${block.slice(0, 200)}`,
      ).toBe(201);
    }
  });

  /**
   * The order is a CONTRACT, and it is ordered for how agents actually read:
   * they truncate. Measured on the production matrix, pi fetched this page with
   * `head -c 6000` and opencode with `head -100`, while the data vocabulary
   * began at byte 15,493 and the document rules at 24,807 — so both wrote a
   * data document having seen neither, and failed publish repeatedly.
   *
   * What a document cannot be written without now comes FIRST — a short auth
   * recap, the data path, the rules a document lives by — then the endpoint
   * reference, then the long material, with the full auth preference list moved
   * down to where a reader who needs it will look.
   */
  it('orders the doc for a reader who truncates: essentials first, reference after', async () => {
    const res = await getDoc(request('/docs/llm'));
    const text = await res.text();
    const sections = [
      '## Read first',
      '## Rules every document lives by',
      '### Create an artifact',
      '### Update an artifact',
      '### Read one back',
      '### List your artifacts',
      '## Errors',
    ];
    const indices = sections.map((s) => ({ s, i: text.indexOf(s) }));
    for (const { s, i } of indices) expect(i, `missing section: ${s}`).toBeGreaterThan(-1);
    const positions = indices.map(({ i }) => i);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('points all deep docs at /docs/* — the old /api doc URLs are gone', async () => {
    const res = await getDoc(request('/docs/llm'));
    const text = await res.text();
    const index = await (await docsIndexRoute(request('/docs'))).text();
    for (const path of ['/docs/artifactbin/SKILL.md', '/docs/artifactbin/references/publishing.md', '/docs/artifactbin/references/markup.md', '/docs/artifactbin/references/themes.md', '/docs/artifactbin/references/templates.md', '/docs/artifactbin/references/design.md']) {
      expect(index).toContain(`${BASE}${path}`);
    }
    expect(text).not.toContain(`${BASE}/api/markup`);
    expect(text).not.toContain('llm-docs');
  });
});
