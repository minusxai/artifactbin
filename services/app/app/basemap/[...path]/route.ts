/**
 * SPIKE (M0): same-origin proxy for the OpenFreeMap vector basemap. A served
 * document may only fetch from 'self', so the style, TileJSON, vector tiles,
 * glyphs and sprites all come through here; the browser's MapLibre
 * rewrites upstream URLs onto this route (transformRequest). Allowlisted —
 * not an open proxy. Also serves MapLibre's CSP worker, which may not be a blob.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const UPSTREAM = 'https://tiles.openfreemap.org';
const ALLOWED = [
  /^styles\/(positron|dark)$/,
  /^planet$/,
  /^planet\/[\w-]+\/\d{1,2}\/\d{1,7}\/\d{1,7}\.pbf$/,
  /^fonts\/[\w %,-]+\/\d{1,5}-\d{1,5}\.pbf$/,
  /^sprites\/ofm_f384\/ofm(@2x)?\.(json|png)$/,
  /^natural_earth\/ne2sr\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/,
];

export async function GET(_request: Request, ctx: { params: Promise<{ path: string | string[] }> }) {
  const { path: raw } = await ctx.params;
  const path = typeof raw === 'string' ? raw : raw.join('/');
  if (path === 'worker.js') {
    const file = createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl-csp-worker.js');
    return new Response(await readFile(file), { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (!ALLOWED.some(re => re.test(path))) return new Response('not found', { status: 404 });
  const resp = await fetch(`${UPSTREAM}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!resp.ok) return new Response('bad gateway', { status: 502 });
  const type = resp.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(resp.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' } });
}
