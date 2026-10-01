/**
 * EVERY ARTIFACT ADDRESS IS SOLID'S (lib/solid-routes isSolidPage): no markup answer the app page serves
 * may fall back to the Solid SPA any more. What is left without the compiled page is the starter
 * placeholder's READ view (its instructions are app UI, solid/pages/Starter); its `/edit`, a capture of
 * it and a keyed capture of any document are the compiled page, whose idle entry is the Solid reader's.
 * The standalone renderer's `legacy` fallback is gone: a compile that cannot be served is a 500, never
 * a page drawn by the retired React reader.
 */
import { describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { artifactPageAnswer } from '@/lib/artifact-page';
import { mintToken } from '@/lib/tokens';
import { mintExportKey } from '@/lib/export-key';
import { START_PLACEHOLDER_MARKUP } from '@/lib/start-placeholder';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { CompiledPageFailed } from '@/lib/compiled-page/serve.server';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();

const PAGE = { spa: { entry: '/solid-spa-idle.ts', preload: [] } };

async function publish(body: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const { token } = await mintToken('address');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  await drainPreparedPageWarmups();
  return { id: ((await made.json()) as { id: string }).id, token };
}

describe('the starter placeholder', () => {
  it('reads as app UI (not compiled) but opens its editor on the compiled page', async () => {
    const { id, token } = await publish({ title: null, markup: START_PLACEHOLDER_MARKUP });
    const read = await artifactPageAnswer(request(`/a/${id}`, { token }), id, { page: PAGE });
    expect(read.status).toBe(200);
    expect(read.compiled).toBeUndefined();
    expect((read.body as { surface: { starter: boolean } }).surface.starter).toBe(true);
    const edit = await artifactPageAnswer(request(`/a/${id}/edit`, { token }), id, { page: PAGE });
    expect(edit.compiled?.html).toContain('/solid-spa-idle.ts');
  });

  it('is photographed as the document it is: a keyed capture is compiled', async () => {
    const { id } = await publish({ title: null, markup: START_PLACEHOLDER_MARKUP });
    const capture = await artifactPageAnswer(request(`/a/${id}?key=${mintExportKey(id)}`), id, { page: PAGE });
    expect(capture.compiled?.html).toContain('Waiting for your agent');
  });
});

describe('a keyed capture of a document', () => {
  it('is the compiled page with the Solid idle entry, never the React reader', async () => {
    const { id } = await publish({ title: 'Captured', markup: '<h1>Captured heading</h1>' });
    const capture = await artifactPageAnswer(request(`/a/${id}?key=${mintExportKey(id)}`), id, { page: PAGE });
    expect(capture.reader).toEqual({ mode: 'compiled' });
    expect(capture.compiled?.html).toContain('Captured heading');
    expect(capture.compiled?.html).toContain('/solid-spa-idle.ts');
  });
});

describe('a compile that cannot be served', () => {
  it('is a failed page: a recorded compile failure has no renderer to fall back to', async () => {
    const { id } = await publish({ title: 'Broken', markup: '<h1>Broken heading</h1>' });
    const db = await harness.db();
    // The first read stores this version's compile.
    expect((await artifactPageAnswer(request(`/a/${id}`), id, { page: PAGE })).reader).toEqual({ mode: 'compiled' });
    const build = (await db.query<{ build: string | null }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build;
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $2::jsonb) WHERE artifact_id = $1`, [id, JSON.stringify({ build, error: 'boom', reason: 'compile-error' })]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(artifactPageAnswer(request(`/a/${id}`), id, { page: PAGE })).rejects.toBeInstanceOf(CompiledPageFailed);
    error.mockRestore();
  });
});
