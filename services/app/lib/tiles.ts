/**
 * The same-origin map-tile proxy path. A served document may only load images
 * from 'self' (lib/story/markup-csp: `img-src 'self' data: blob:`), so the
 * point-map street basemap cannot reference Carto's CDN directly — it fetches
 * `/tiles/<style>/{z}/{x}/{y}.png` on the document's own origin instead, and
 * this module is the one mapping from that path onto the Carto upstream.
 *
 * Two things answer the path: in production, nginx intercepts `/tiles/` before
 * Next ever sees it (same allowlist, plus an on-disk cache); `app/tiles` is the
 * identical mapping for dev/CI so every environment serves tiles the same way
 * and the nginx block is a cache in front, never required for correctness.
 *
 * The allowlist is the security boundary: only the two Carto basemap styles the
 * theme swap uses, numeric slippy coordinates, `.png` (optional `@2x`). This is
 * NOT an open proxy — an unrecognized path resolves to null and 404s.
 */

/** The Carto basemap styles the app ships (light theme / dark theme). */
export const TILE_STYLES = ['light_all', 'dark_all'] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

/**
 * Carto's CDN, bare host — the `a.`–`d.` shards exist only for pre-HTTP/2
 * browser connection parallelism and serve identical tiles.
 */
export const TILE_UPSTREAM_ORIGIN = 'https://basemaps.cartocdn.com';

/**
 * The browser-facing `{z}/{x}/{y}` template for a style — root-relative, so it
 * resolves against whatever origin serves the document (prod nginx, dev Next).
 */
export function tileUrlTemplate(style: TileStyle): string {
  return `/tiles/${style}/{z}/{x}/{y}.png`;
}

// Slippy coordinates: z is 0–19 in practice (the vega signal clamps there), x/y
// grow with zoom. Two digits of z and seven of x/y comfortably cover z=19's
// 2^19 tiles per axis; anything longer is not a tile ask. Mirrors the nginx
// location regex — keep the two in step.
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
