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
import { fileNameFromUrl } from '@/lib/file-display';
import { pdfFilename } from '@/lib/story/pdf-store';
import { webAssetByHash } from '@/lib/web-assets';

/** Every asset response carries these, whatever the asset turns out to be. */
export const ASSET_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Security-Policy': 'sandbox',
  'Content-Disposition': 'attachment',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

/**
 * THE ONE TYPE THAT IS NOT AN ATTACHMENT, and it is not a widening of R15.
 *
 * `attachment` is here because a stored SVG is MARKUP and a navigation to one
 * must not become a page in this origin. A PDF is not markup: it cannot script,
 * `nosniff` holds the browser to the type sniffed from the bytes at import, and
 * `Content-Security-Policy: sandbox` — kept, and the actual defence — was
 * measured putting the response at an opaque origin where storage and cookies
 * both throw (spike S4). It does not stop the browser's own viewer.
 *
 * What `attachment` costs a PDF is the entire feature: opened from inside a
 * document's sandbox it produced neither a popup nor an observable download,
 * so a <File> card linking an imported PDF would click into nothing. The
 * filename comes from the SOURCE URL's last segment, because the address here
 * is a 64-hex hash and a browser would otherwise save the file under it.
 */
const dispositionFor = (contentType: string, url: string): string => {
  if (contentType !== 'application/pdf') return 'attachment';
  // fileNameFromUrl's decode cannot throw — a lone `%` in a filename is
  // ordinary, and a bare decodeURIComponent here made this address 500 for a
  // PDF that had imported perfectly (see lib/file-display).
  const name = (fileNameFromUrl(url) ?? '').replace(/\.pdf$/i, '');
  return `inline; filename="${pdfFilename(name, 'file')}"`;
};

export async function GET(_request: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  const row = await webAssetByHash(hash);
  if (!row) return new Response('not found', { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await objectStore().get(row.object_key);
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
    headers: { 'Content-Type': row.content_type, ...ASSET_HEADERS, 'Content-Disposition': dispositionFor(row.content_type, row.url) },
  });
}
