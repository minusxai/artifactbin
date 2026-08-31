/**
 * The same-origin map-tile proxy (lib/tiles + app/tiles): a served document may
 * only load images from 'self' (markup CSP), so the point-map basemap templates
 * must be root-relative proxied paths, the route must answer ONLY the
 * allowlisted tile shape (never an open proxy), and the theme swap must treat
 * the retired absolute Carto URLs as defaults — detached specs stored before
 * the proxy existed carry them baked in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE_UPSTREAM_ORIGIN, tileUpstreamUrl, tileUrlTemplate } from '@/lib/tiles';
import { POINT_MAP_DARK_TILE_URL, POINT_MAP_DEFAULT_TILE_URL, themeTileUrl } from '@/lib/viz/viz-templates';
import { GET as serveTile } from '@/app/tiles/[...tile]/route';

const routeCtx = (tile: string[]) => ({ params: Promise.resolve({ tile }) });
const REQ = new Request('http://localhost:3000/tiles/dark_all/3/2/3.png');

afterEach(() => vi.unstubAllGlobals());

describe('tile templates', () => {
  it('point-map defaults are root-relative proxied paths, not cartocdn', () => {
    expect(POINT_MAP_DEFAULT_TILE_URL).toBe('/tiles/light_all/{z}/{x}/{y}.png');
    expect(POINT_MAP_DARK_TILE_URL).toBe('/tiles/dark_all/{z}/{x}/{y}.png');
  });

  it('the recipe constants and the proxy module agree on the path shape', () => {
    expect(tileUrlTemplate('light_all')).toBe(POINT_MAP_DEFAULT_TILE_URL);
    expect(tileUrlTemplate('dark_all')).toBe(POINT_MAP_DARK_TILE_URL);
  });
});

describe('themeTileUrl (the theme swap, pure)', () => {
  it('swaps a default to the mode-matching default', () => {
    expect(themeTileUrl(POINT_MAP_DEFAULT_TILE_URL, 'dark')).toBe(POINT_MAP_DARK_TILE_URL);
    expect(themeTileUrl(POINT_MAP_DARK_TILE_URL, 'light')).toBe(POINT_MAP_DEFAULT_TILE_URL);
  });

  it('treats the retired absolute Carto URLs as defaults (stored detached specs)', () => {
    expect(themeTileUrl('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'light')).toBe(POINT_MAP_DEFAULT_TILE_URL);
    expect(themeTileUrl('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'light')).toBe(POINT_MAP_DEFAULT_TILE_URL);
    expect(themeTileUrl('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'dark')).toBe(POINT_MAP_DARK_TILE_URL);
  });

  it('leaves a custom tileUrl untouched (null), and refuses non-strings', () => {
    expect(themeTileUrl('https://tiles.example.com/{z}/{x}/{y}.png?key=abc', 'dark')).toBeNull();
    expect(themeTileUrl(undefined, 'dark')).toBeNull();
    expect(themeTileUrl(42, 'light')).toBeNull();
  });
});

describe('tileUpstreamUrl (the allowlist)', () => {
  it('maps an allowlisted tile path onto the Carto upstream', () => {
    expect(tileUpstreamUrl(['dark_all', '3', '2', '3.png'])).toBe(`${TILE_UPSTREAM_ORIGIN}/dark_all/3/2/3.png`);
    expect(tileUpstreamUrl(['light_all', '19', '271829', '175033.png'])).toBe(`${TILE_UPSTREAM_ORIGIN}/light_all/19/271829/175033.png`);
    expect(tileUpstreamUrl(['light_all', '3', '2', '3@2x.png'])).toBe(`${TILE_UPSTREAM_ORIGIN}/light_all/3/2/3@2x.png`);
  });

  it('rejects everything outside the allowlist', () => {
    expect(tileUpstreamUrl(['voyager', '3', '2', '3.png'])).toBeNull();          // unknown style
    expect(tileUpstreamUrl(['dark_all', '123', '2', '3.png'])).toBeNull();       // z beyond 2 digits
    expect(tileUpstreamUrl(['dark_all', '3', '2', '3.jpg'])).toBeNull();         // not png
    expect(tileUpstreamUrl(['dark_all', '3', '2', '3.png', 'x'])).toBeNull();    // extra segment
    expect(tileUpstreamUrl(['dark_all', '3', '2'])).toBeNull();                  // missing segment
    expect(tileUpstreamUrl(['dark_all', '3', '..', '3.png'])).toBeNull();        // traversal
    expect(tileUpstreamUrl(['dark_all', '3', '2', '..%2F3.png'])).toBeNull();    // encoded junk
    expect(tileUpstreamUrl(['dark_all', '-1', '2', '3.png'])).toBeNull();        // negative
  });
});

describe('GET /tiles (dev/CI leg of the proxy)', () => {
  it('404s a non-allowlisted path WITHOUT contacting the upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('must not fetch'); }));
    const res = await serveTile(REQ, routeCtx(['voyager', '3', '2', '3.png']));
    expect(res.status).toBe(404);
  });

  it('proxies an allowlisted tile: upstream bytes, image/png, long-lived cache', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await serveTile(REQ, routeCtx(['dark_all', '3', '2', '3.png']));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${TILE_UPSTREAM_ORIGIN}/dark_all/3/2/3.png`);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toMatch(/public/);
    // The served document's origin is opaque, and vega loads tile images
    // crossOrigin=anonymous — without ACAO the browser discards the response.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });

  it('answers an upstream failure as 502, not a cached-looking 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const res = await serveTile(REQ, routeCtx(['dark_all', '3', '2', '3.png']));
    expect(res.status).toBe(502);
  });
});
