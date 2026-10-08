/**
 * EVERY ARTIFACT ADDRESS IS SOLID'S (lib/solid-routes isSolidPage), and a document on the app page is ONE frame on
 * its own origin (lib/serving/document-frame): the app page renders no document. What is left without a frame is the
 * starter placeholder's READ view (its instructions are app UI, solid/pages/Starter); its `/edit` is framed. The
 * document itself is rendered only by the standalone compiled page (`/raw`), which is what a capture photographs, and
 * a compile that cannot be served there is a 500 — there is no other renderer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { artifactPageAnswer, pagesSite } from '@/lib/serving';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { mintExportKey } from '@/lib/serving';
import { START_PLACEHOLDER_MARKUP } from '@/lib/serving';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';

const harness = useAppHarness();
beforeEach(() => setSession(null));

const PAGES = { pages: pagesSite() };
const raw = (id: string, search = '') => rawRoute(request(`/a/${id}/raw${search}`), { params: Promise.resolve({ id }) });

async function publish(body: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const { token } = await mintToken('address');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  await drainPreparedPageWarmups();
  return { id: ((await made.json()) as { id: string }).id, token };
}

describe('the starter placeholder', () => {
  it('reads as app UI (not framed) but opens its editor on the framed document', async () => {
    const { id, token } = await publish({ title: null, markup: START_PLACEHOLDER_MARKUP });
    const read = await artifactPageAnswer(request(`/a/${id}`, { token }), id, PAGES);
    expect(read.status).toBe(200);
    expect(read.frame).toBeUndefined();
    expect((read.body as { surface: { starter: boolean } }).surface.starter).toBe(true);
    const edit = await artifactPageAnswer(request(`/a/${id}/edit`, { token }), id, PAGES);
    expect(edit.frame?.src).toContain('/pages-session?');
  });

  it('is photographed as the document it is: a keyed capture of /raw is compiled', async () => {
    const { id } = await publish({ title: null, markup: START_PLACEHOLDER_MARKUP });
    const capture = await raw(id, `?chrome=0&key=${mintExportKey(id)}`);
    expect(capture.status).toBe(200);
    expect(await capture.text()).toContain('Waiting for your agent');
  });
});

describe('a document on the app page', () => {
  it('is its frame on its own origin: the answer names the document and carries none of it', async () => {
    const { id, token } = await publish({ title: 'Framed', markup: '<h1>Framed heading</h1>' });
    const answer = await artifactPageAnswer(request(`/a/${id}`, { token }), id, PAGES);
    expect(answer.reader).toEqual({ mode: 'compiled' });
    expect(answer.frame?.src).toMatch(/\/pages-session\?(?:ticket=[^&]+&)?next=/);
    expect(decodeURIComponent(answer.frame!.src)).toContain(`.${pagesSite().host}`);
    expect(answer.frame?.head.title).toBe('Framed');
    // The JSON door mints no ticket and draws no frame.
    expect((await artifactPageAnswer(request(`/a/${id}`, { token }), id)).frame).toBeUndefined();
  });
});

describe('a keyed capture of a document', () => {
  it('is the compiled standalone page, never the app page', async () => {
    const { id } = await publish({ title: 'Captured', markup: '<h1>Captured heading</h1>' });
    const capture = await raw(id, `?chrome=0&key=${mintExportKey(id)}`);
    expect(capture.headers.get('x-mx-reader')).toBe('compiled');
    const html = await capture.text();
    expect(html).toContain('Captured heading');
    expect(html).not.toContain('data-mx-spa-idle');
  });
});

describe('a compile that cannot be served', () => {
  it('is a 500 from the one renderer: a recorded compile failure has nothing to fall back to', async () => {
    const { id } = await publish({ title: 'Broken', markup: '<h1>Broken heading</h1>' });
    const db = await harness.db();
    // The first read stores this version's compile.
    expect((await raw(id)).status).toBe(200);
    const build = (await db.query<{ build: string | null }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build;
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $2::jsonb) WHERE artifact_id = $1`, [id, JSON.stringify({ build, error: 'boom', reason: 'compile-error' })]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await raw(id)).status).toBe(500);
    error.mockRestore();
  });
});
