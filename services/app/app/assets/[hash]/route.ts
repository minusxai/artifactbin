/**
 * GET /assets/<sha256 of the canonical url> — our copy of a web asset a
 * document names by URL (lib/web-assets).
 *
 * Content-addressed BY THE URL that produced it, so `immutable` is honest: the
 * address never moves, and `refresh_asset` repointing the row is the one way
 * the bytes behind it change (a reader who already cached this keeps the old
 * copy until the entry expires — the stated cost of an address that a stored
 * document can keep naming).
 *
 * THE THREE DEFENSIVE HEADERS ARE THE POINT. An imported SVG is markup, and a
 * top-level navigation to one served plainly runs it in THIS origin — the
 * spike measured storage and cookies reachable from a document any user could
 * cause us to store. `Content-Security-Policy: sandbox` gives such a
 * navigation an opaque origin, `Content-Disposition: attachment` makes it a
 * download rather than a page, and `nosniff` holds the browser to the type we
 * sniffed from the bytes at import. None of the three touches a subresource
 * load: an `<img>`, a `<link rel=preload>` and an `@font-face` all still use
 * these bytes, which is what `scripts/gate-web-assets.mjs` proves in a real
 * browser. ACAO for the reason /webfonts carries it: a served document has an
 * opaque origin, so its own font fetch is a CORS request.
 *
 * The hash is the whole input, matched against a 64-hex shape before it is a
 * lookup — nothing here concatenates a caller's string into a path — and an
 * unknown hash is a 404 like /webfonts, for the same reason: this is a read
 * whose key comes from the CALLER, so a miss is routine rather than an anomaly.
 */
import { objectStore } from '@/lib/object-store';
import { VARIANT_CONTENT_TYPE } from '@/lib/images/optimise';
import { webAssetByHash } from '@/lib/web-assets';

/** Every asset response carries these, whatever the asset turns out to be. */
export const ASSET_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Security-Policy': 'sandbox',
  'Content-Disposition': 'attachment',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

export async function GET(request: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  const row = await webAssetByHash(hash);
  if (!row) return new Response('not found', { status: 404 });
  /*
   * `w=` NAMES A WIDTH WE STORED — it is not a resize anyone may ask for. The
   * srcset the mapping writes offers exactly the row's `small_width`, so the
   * one value that selects the narrow copy is the one we made; everything else
   * (an old address, a hand-typed number, nothing at all) is the full copy,
   * because a width is a preference and never a reason to fail a picture.
   *
   * `v=` is read by nobody: it is the CACHE KEY a refresh moves (R19), and the
   * bytes it addresses are simply whatever the row points at now.
   */
  const width = new URL(request.url).searchParams.get('w');
  const narrow = row.small_object_key && width !== null && Number(width) === row.small_width;
  let bytes: Buffer;
  try {
    bytes = await objectStore().get(narrow ? row.small_object_key! : row.object_key);
  } catch {
    // A row promising bytes the store will not give is corruption or broken
    // credentials — but this is a public asset address, and answering a caller
    // with a 500 for it would turn our fault into their broken page. 404, like
    // /webfonts, and for the same reasons written out there.
    return new Response('not found', { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    // Built fresh per response: @hono/node-server writes the computed
    // Content-Length back INTO this object, so a shared constant would
    // announce the first body's length for every later one.
    headers: { 'Content-Type': narrow ? VARIANT_CONTENT_TYPE : row.content_type, ...ASSET_HEADERS },
  });
}
