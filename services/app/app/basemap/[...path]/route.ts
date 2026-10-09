/**
 * The same-origin leg of the `<DeckGL>` basemap (lib/viz/basemap). A served document
 * may only fetch from 'self', so the style, TileJSON, vector tiles, glyphs and
 * sprites all come through here, and MapLibre's module worker — which may not be a
 * blob: — is served from here too. Only lib/viz/basemap's allowlist is forwarded.
 *
 * maplibre-gl is a build dependency, absent from the production image, so the
 * worker (one self-contained module) is served from the copy
 * scripts/build-server-reader.mjs places in lib/build-assets.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASEMAP_ALLOWED, BASEMAP_UPSTREAM } from '@/lib/viz/basemap';

export async function GET(_request: Request, ctx: { params: Promise<{ path: string | string[] }> }) {
  const { path: raw } = await ctx.params;
  const upstreamPath = typeof raw === 'string' ? raw : raw.join('/');
  if (upstreamPath === 'worker.mjs') {
    const file = path.join(process.cwd(), 'lib', 'build-assets', 'maplibre-gl-worker.mjs');
    return new Response(await readFile(file), { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (!BASEMAP_ALLOWED.some(re => re.test(upstreamPath))) return new Response('not found', { status: 404 });
  const resp = await fetch(`${BASEMAP_UPSTREAM}/${upstreamPath.split('/').map(encodeURIComponent).join('/')}`);
  if (!resp.ok) return new Response('bad gateway', { status: 502 });
  const type = resp.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(resp.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' } });
}
