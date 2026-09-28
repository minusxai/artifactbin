/**
 * THE MANAGED ASSET DOOR ON A COMPILED PAGE (lib/islands/contract IslandPageData.managedAssets): a
 * deployment with an asset origin gives every reader path the same `{ origin, resolveUrl }` today's
 * renderer puts on its island (app/a/[id]/raw), in the page's data island — never compiled into the
 * version's module, so one compile serves every host and every capture key. A capture carries its
 * verified export key in the door, as today's does; a deployment without an asset origin carries none.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const settings = vi.hoisted(() => ({ assets: 'https://assets.example.test' as string | null }));
vi.mock('@/lib/config', async (original) => ({
  ...(await original<typeof import('@/lib/config')>()),
  get ASSETS_ORIGIN() { return settings.assets; },
}));
vi.mock('@/auth', () => ({ auth: async () => null }));

import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { setCompiledReaderFlagForTests } from '@/lib/compiled-page/reader-mode';
import { ISLAND_DATA_ID, READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { mintExportKey } from '@/lib/export-key';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });

beforeAll(() => setCompiledReaderFlagForTests('shadow'));
afterAll(() => setCompiledReaderFlagForTests(null));

const FRAME = '<div><Iframe title="Gallery" height={100}><img src="https://img.example/a.png" alt="a" /></Iframe></div>';

async function publishFrame(): Promise<string> {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_assets_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('assets'); await claimToken(user.id, t.token);
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', title: 'Frame', markup: FRAME } }));
  if (made.status !== 201) throw new Error(await made.text());
  const id = ((await made.json()) as { id: string }).id;
  await drainPreparedPageWarmups();
  return id;
}
const raw = (id: string, search = '') => rawRoute(request(`/a/${id}/raw${search}`), params(id));
const islandOf = async (res: Response): Promise<Record<string, unknown>> =>
  JSON.parse(new JSDOM(await res.text()).window.document.getElementById(ISLAND_DATA_ID)?.textContent ?? '{}') as Record<string, unknown>;

describe('the managed asset door on the compiled page', () => {
  it('/raw carries today\'s door in the data island, and the version\'s module compiles none in', async () => {
    const id = await publishFrame();
    const legacy = await islandOf(await raw(id));
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const html = await res.clone().text();
    const island = await islandOf(res);
    expect(legacy.managedAssets, 'today\'s island carries the door').toMatchObject({ origin: 'https://assets.example.test' });
    expect(island.managedAssets).toEqual(legacy.managedAssets);
    expect((island.managedAssets as { resolveUrl: string }).resolveUrl).toMatch(new RegExp(`^https?://[^/]+/a/${id}/assets$`));
    expect(html).not.toContain('assetsOrigin');
  });

  it('a capture carries its verified export key in the door, as today\'s does', async () => {
    const id = await publishFrame();
    const capture = `chrome=0&key=${encodeURIComponent(mintExportKey(id))}`;
    const legacy = await islandOf(await raw(id, `?${capture}`));
    const res = await raw(id, `?reader=compiled&${capture}`);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const island = await islandOf(res);
    expect((legacy.managedAssets as { resolveUrl: string }).resolveUrl).toContain('?key=');
    expect(island.managedAssets).toEqual(legacy.managedAssets);
  });

  it('/a/:id carries the door for the reader\'s own page', async () => {
    const id = await publishFrame();
    const res = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const island = await islandOf(res);
    expect(island.managedAssets).toEqual({ origin: 'https://assets.example.test', resolveUrl: expect.stringMatching(new RegExp(`^https?://[^/]+/a/${id}/assets$`)) });
  });

  it('a deployment without an asset origin carries no door', async () => {
    settings.assets = null;
    try {
      const id = await publishFrame();
      const island = await islandOf(await raw(id, '?reader=compiled'));
      expect(island).not.toHaveProperty('managedAssets');
    } finally {
      settings.assets = 'https://assets.example.test';
    }
  });
});
