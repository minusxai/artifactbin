/**
 * The ONE document format — `markup` (the story engine):
 *  - `POST {markup}` publishes through the engine (validate → sanitize →
 *    compile) and stores format 'markup' — the wire and the DB speak the same
 *    vocabulary, no aliases.
 * There is no second authoring language: prose is written as ordinary HTML
 * tags inside the same document (see __tests__/markup-only-input.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const MD_DOC = `# Q3 in review

Revenue was **up 40%**, driven by the EU expansion.

## What moved

- New logos: 14
- Churn: 0.8%
`;

describe('markup — the one document tier', () => {
  it('POST {markup} publishes through the story engine as public format "markup"', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1 className="text-4xl font-bold tracking-tight">Hi</h1>', theme: 'terminal' } }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; format: string };
    expect(body.format).toBe('markup');

    const read = await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }));
    const wire = (await read.json()) as { format: string; markup: string; theme: string | null; id: string };
    expect(wire.format).toBe('markup');
    expect(wire.markup).toContain('<h1');
    expect(wire.theme).toBe('terminal');
    // Engine row: the source IS the artifact, served as text at ./raw while
    // /a/<id> renders it live.
    const serve = await serveArtifact(request(`/a/${wire.id}/raw`), params({ id: wire.id }));
    expect(serve.status).toBe(200);
    expect(await serve.text()).toContain('<h1');
  });

  it('POST {jsx} is no longer a content field — the retired alias is rejected', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { jsx: '<p className="max-w-prose">alias</p>' } }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('markup_only');
  });

  it('stores format "markup" in the DB — the wire vocabulary IS the stored vocabulary', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p className="max-w-prose">stored</p>' } }),
    );
    const { id } = (await res.json()) as { id: string };
    const db = await harness.db();
    const { rows } = await db.query<{ format: string }>('SELECT format FROM artifacts WHERE id = $1', [id]);
    expect(rows[0].format).toBe('markup');
  });

  it('rejects legacy markup vocabulary with the engine diagnostics (no silent legacy path)', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<NotAKitComponent x={1} />' } }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_jsx');
  });
});
