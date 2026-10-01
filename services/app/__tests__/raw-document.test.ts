/** The admitted /raw response is a compiled document with a scoped sandbox. */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { markupCsp } from '@/lib/story/styles/markup-csp';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const publish = async (markup: string): Promise<string> => {
  const token = await mintToken('raw-document');
  const response = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup } }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};
const raw = async (id: string, query = '') => serveArtifact(request(`/a/${id}/raw${query}`), params(id));
const island = (html: string): Record<string, unknown> | null => {
  const match = new RegExp(`<script type="application/json" id="${ISLAND_DATA_ID}">([^<]*)<\\/script>`).exec(html);
  return match ? JSON.parse(match[1]) as Record<string, unknown> : null;
};

describe('/a/:id/raw compiled markup', () => {
  it('serves a complete first paint with inert author script data and a content-addressed reader module', async () => {
    const id = await publish('<Helmet><title>Scripted doc</title><script>{`document.body.dataset.ran = "1";`}</script></Helmet><Card><CardContent>Hello</CardContent></Card>');
    await drainPreparedPageWarmups();
    const response = await raw(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-mx-reader')).toBe('compiled');
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<title>Scripted doc</title>');
    expect(html).toContain('Hello');
    expect(html).toContain(`id="${ISLAND_DATA_ID}"`);
    expect(html).toMatch(/<script type="module" src="\/islands\/d\/[0-9a-f]{16}\.js\?b=[0-9a-f]{16}" crossorigin><\/script>/);
    expect(island(html)?.authorScript).toContain('document.body.dataset.ran');
    expect(html).not.toContain('type="text/mx-author"');
  });

  it('scopes the sandbox to this document and admits the island SQLite engine when needed', async () => {
    const id = await publish('<Helmet><Value name="region" type="string" default="north" /></Helmet><select value="$region"><option value="north">north</option></select>');
    const response = await raw(id);
    expect(response.headers.get('Content-Security-Policy')).toBe(markupCsp(BASE, id, undefined, { compiled: true }));
    const csp = response.headers.get('Content-Security-Policy')!;
    expect(csp).toContain(`${BASE}/islands/`);
    expect(csp).not.toMatch(/connect-src[^;]*'self'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain('sandbox allow-scripts');
    const html = await response.text();
    expect(island(html)?.sqliteWasm).toBeUndefined();
    expect(loadCompilerBuild().sqliteWasm).toMatch(/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('seeds declared data and query door without putting source rows in the HTML', async () => {
    const id = await publish('<Helmet><Value name="region" type="string" default="north" /></Helmet><select aria-label="Region" value="$region"><option value="north">north</option><option value="west">west</option></select>');
    const html = await raw(id, '?$region=west').then((response) => response.text());
    const data = island(html);
    expect(data?.values).toEqual({ region: 'west' });
    expect(data?.queryUrl).toBe(`/a/${id}/query`);
    expect(data?.results).toBeNull();
    expect(html).toContain('aria-label="Region"');
  });

  it('serves plain prose without an island or module, and a capture without deck chrome', async () => {
    const prose = await publish('<div><h1>Hello</h1></div>');
    const plain = await raw(prose).then((response) => response.text());
    expect(plain).not.toContain(`id="${ISLAND_DATA_ID}"`);
    expect(plain).not.toMatch(/<script type="module" src="\/islands\/d\//);
    const deck = await publish('<SlideDeck><Slide title="A"><h1>One</h1></Slide><Slide title="B"><h1>Two</h1></Slide></SlideDeck>');
    const withChrome = await raw(deck).then((response) => response.text());
    expect(withChrome).toContain('Slide controls');
    const bare = await raw(deck, '?chrome=0').then((response) => response.text());
    expect(bare).not.toContain('Slide controls');
    expect(bare).toContain('One');
  });
});

describe('/a/:id/raw retired formats', () => {
  it.each(['html', 'markdown'])('returns the same 404 as an absent document for %s', async (format) => {
    const id = await publish('<p>placeholder</p>');
    const db = await harness.db();
    await db.query('UPDATE artifacts SET format = $1, source = NULL WHERE id = $2', [format, id]);
    const response = await raw(id);
    const absent = await raw('zzzzzz');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await absent.text());
  });
});
