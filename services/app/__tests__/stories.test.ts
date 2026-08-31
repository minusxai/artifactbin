/**
 * Document-tier lifecycle over the story engine: format switching, versioning
 * and revert, user-scope editing, and the preview compile. (Creation-path
 * contracts live in markup-tier.test.ts; this file covers the flows AROUND
 * publish.) The retired static render tiers have no input path anymore — see
 * the pre-engine coverage in markup-tier.test.ts for how their rows serve.
 */
import { describe, expect, it } from 'vitest';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { replaceArtifactFor } from '@/lib/artifacts';


import { parseContentInput } from '@/lib/story/input';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('document creation guards', () => {
  it('rejects a retired input, no input, and an unknown theme', async () => {
    const t = await mintToken('t');
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ markup: '<p>x</p>', markdown: '# x' }, 'markup_only'],
      [{ title: 'x' }, 'one_of_markup_dataset_viz_image'],
      [{ markup: '<p>x</p>', theme: 'vaporwave' }, 'unknown_theme'],
    ];
    for (const [body, error] of cases) {
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: body }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
  });

  it('rejects a retired theme BY NAME, hinting the successor', async () => {
    const t = await mintToken('t');
    const cases: Array<[string, string]> = [
      ['classical', 'manuscript'],
      ['broadsheet', 'manuscript'],
      ['nocturne', 'modernist'],
    ];
    for (const [theme, successor] of cases) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>x</p>', theme } }),
      );
      expect(res.status, theme).toBe(400);
      const body = await res.json();
      expect(body.error, theme).toBe('retired_theme');
      expect(body.hint, theme).toContain(successor);
    }
  });
});

describe('retired themes on stored rows', () => {
  it('a stored nocturne row serves as modernist-dark with the dark theme block in its sheet', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Legacy</h1>', theme: 'modernist' } }),
      )
    ).json();
    // Shape the row like a document published before the retirement: the old
    // theme name and a sheet compiled under the old registry (stale version).
    const db = await harness.db();
    await db.query(
      `UPDATE artifacts SET meta = meta || '{"theme":"nocturne","cssCompileVersion":"v-legacy"}' WHERE id = $1`,
      [created.id],
    );
    const res = await serveArtifact(request(`/a/${created.id}/raw`), params({ id: created.id }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-theme="modernist"');
    expect(html).toMatch(/<html[^>]*class="dark"/);
    // The frozen legacy sheet had no dark block — serving must have recompiled.
    expect(html).toContain(':root:where([data-theme="modernist"].dark)');
  });
});

describe('document editing', () => {
  it('PUT republishes; revert restores the old source and theme', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>First</h1>', theme: 'manuscript' } }),
      )
    ).json();
    expect(created.format).toBe('markup');

    const put = await putArtifact(
      request(`/api/artifacts/${created.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1>Second</h1>', theme: 'industry' } }),
      params({ id: created.id }),
    );
    expect(put.status).toBe(200);
    expect((await put.json()).version).toBe(2);

    let read = await (
      await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: t.token }), params({ id: created.id }))
    ).json();
    expect(read.markup).toContain('Second');
    expect(read.theme).toBe('industry');

    const revert = await revertRoute(
      request(`/api/artifacts/${created.id}/revert`, { method: 'POST', token: t.token, json: { version: 1 } }),
      params({ id: created.id }),
    );
    expect(revert.status).toBe(200);

    read = await (
      await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: t.token }), params({ id: created.id }))
    ).json();
    expect(read.markup).toContain('First');
    expect(read.markup).not.toContain('Second');
    expect(read.theme).toBe('manuscript');
    expect(read.format).toBe('markup');
  });

  it('an account-scope replace edits any of the user’s artifacts', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Mine</h1>' } }),
      )
    ).json();

    const parsed = await parseContentInput({ markup: '<h1>Edited</h1>', theme: 'organic' });
    if (parsed instanceof Response) throw new Error('parse failed');
    const row = await replaceArtifactFor({ tokenId: '', userId: user.id }, created.id, parsed);
    if (row === null || 'conflict' in row) throw new Error('replace failed');
    expect(row?.version).toBe(2);
    expect(row?.source).toContain('Edited');
    expect(row?.source).toContain('<h1>');

    const other = await createUser({ email: 'other@x.com' });
    expect(await replaceArtifactFor({ tokenId: '', userId: other.id }, created.id, parsed)).toBeNull();
  });

  it('preview compiles the document tier without persisting (bearer auth)', async () => {
    const t = await mintToken('t');
    const res = await previewRoute(
      request('/api/preview', { method: 'POST', token: t.token, json: { markup: '<h1 className="text-2xl font-bold">Draft</h1>' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { format: string; css?: string | null };
    expect(body.format).toBe('markup');
    expect(typeof body.css).toBe('string'); // the compiled per-story sheet
    expect(body.css).toContain('text-2xl');

    // A document carrying markdown previews through the same engine.
    const md = await previewRoute(
      request('/api/preview', { method: 'POST', token: t.token, json: { markup: '<h1>Draft</h1>' } }),
    );
    expect(((await md.json()) as { format: string }).format).toBe('markup');

    const noAuth = await previewRoute(request('/api/preview', { method: 'POST', json: { markup: '<p>x</p>' } }));
    expect(noAuth.status).toBe(401);
  });
});
