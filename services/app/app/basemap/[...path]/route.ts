/**
 * The same-origin leg of the `<DeckGL>` basemap (lib/basemap). A served document
 * may only fetch from 'self', so the style, TileJSON, vector tiles, glyphs and
 * sprites all come through here, and MapLibre's CSP worker — which may not be a
 * blob: — is served from here too. Only lib/basemap's allowlist is forwarded.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BASEMAP_ALLOWED, BASEMAP_UPSTREAM } from '@/lib/basemap';

export async function GET(_request: Request, ctx: { params: Promise<{ path: string | string[] }> }) {
  const { path: raw } = await ctx.params;
  const path = typeof raw === 'string' ? raw : raw.join('/');
  if (path === 'worker.js') {
    const file = createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl-csp-worker.js');
    return new Response(await readFile(file), { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (!BASEMAP_ALLOWED.some(re => re.test(path))) return new Response('not found', { status: 404 });
  const resp = await fetch(`${BASEMAP_UPSTREAM}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!resp.ok) return new Response('bad gateway', { status: 502 });
  const type = resp.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(resp.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' } });
}
