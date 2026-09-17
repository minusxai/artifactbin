/**
 * Dev/CI leg of the map-tile proxy (lib/tiles). Production nginx intercepts
 * `/tiles/` with the same allowlist and an on-disk cache, so this handler is
 * only ever hit where nginx isn't in front — which is exactly why it exists:
 * the point-map basemap URL is root-relative and must work on a laptop too.
 */
import { tileUpstreamUrl } from '@/lib/tiles';

export async function GET(_request: Request, ctx: { params: Promise<{ tile: string[] }> }) {
  const { tile } = await ctx.params;
  const upstream = tileUpstreamUrl(tile);
  if (!upstream) return new Response('not found', { status: 404 });
  const resp = await fetch(upstream);
  if (!resp.ok) return new Response('bad gateway', { status: 502 });
  return new Response(resp.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Tiles are effectively immutable per (style,z,x,y); mirror nginx's 30d.
      'Cache-Control': 'public, max-age=2592000',
      // The document's origin is opaque and vega loads tiles
      // crossOrigin=anonymous — same open CORS the Carto upstream sends.
      'Access-Control-Allow-Origin': '*',
    },
  });
}
