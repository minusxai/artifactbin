/**
 * The same-origin map-tile proxy path. A served document may only load images
 * from 'self' (lib/page-styles/markup-csp: `img-src 'self' data: blob:`), so a
 * page's street basemap cannot reference Carto's CDN directly — it fetches
 * `/tiles/<style>/{z}/{x}/{y}.png` on the document's own origin instead, and
 * this module is the one mapping from that path onto the Carto upstream.
 *
 * `app/tiles` answers the path, so every environment serves tiles without any
 * help. A fronting proxy may serve `/tiles/` itself as a cache — it never has
 * to, and this route stays the whole of the behaviour.
 *
 * The allowlist is the security boundary: only the two Carto basemap styles (light
 * and dark), numeric slippy coordinates, `.png` (optional `@2x`). This is
 * NOT an open proxy — an unrecognized path resolves to null and 404s.
 */

/** The Carto basemap styles the app ships (light theme / dark theme). */
const TILE_STYLES = ['light_all', 'dark_all'] as const;

/**
 * Carto's CDN, bare host — the `a.`–`d.` shards exist only for pre-HTTP/2
 * browser connection parallelism and serve identical tiles.
 */
export const TILE_UPSTREAM_ORIGIN = 'https://basemaps.cartocdn.com';

// Slippy coordinates: z is 0–19 in practice (the vega signal clamps there), x/y
// grow with zoom. Two digits of z and seven of x/y comfortably cover z=19's
// 2^19 tiles per axis; anything longer is not a tile ask.
const Z_RE = /^\d{1,2}$/;
const XY_RE = /^\d{1,7}$/;
const Y_FILE_RE = /^(\d{1,7})(@2x)?\.png$/;

/**
 * Map a `/tiles/...` request's path segments (`[style, z, x, "y.png"]`) onto
 * the upstream Carto URL. Null for anything outside the allowlist — the
 * route answers that with a 404, never a forwarded request.
 */
export function tileUpstreamUrl(segments: readonly string[]): string | null {
  if (segments.length !== 4) return null;
  const [style, z, x, yFile] = segments;
  if (!(TILE_STYLES as readonly string[]).includes(style)) return null;
  const y = yFile.match(Y_FILE_RE);
  if (!Z_RE.test(z) || !XY_RE.test(x) || !y || !XY_RE.test(y[1])) return null;
  return `${TILE_UPSTREAM_ORIGIN}/${style}/${z}/${x}/${yFile}`;
}
