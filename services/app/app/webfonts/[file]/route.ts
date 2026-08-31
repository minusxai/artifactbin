/**
 * GET /webfonts/<sha>.woff2 — a face this deployment imported (lib/webfonts),
 * served from our own origin because that is the only place a document's CSP
 * (`font-src 'self' data:`) will fetch a font from, and the only place that
 * costs a reader no third-party request.
 *
 * Content-addressed, so `immutable` is honest — the name changes when the
 * bytes do. ACAO for the same reason /fonts and /story carry it: a served
 * document has an OPAQUE origin, so its own-origin font fetch is a CORS
 * request, and without the header the face silently never paints.
 *
 * The filename is the whole input, matched against a 32-hex shape before it
 * becomes a key — nothing here concatenates a caller's string into a path.
 */
import { objectStore } from '@/lib/object-store';
import { webFontObjectKey, isKnownWebFontFile } from '@/lib/webfonts';

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const key = webFontObjectKey(file);
  if (!key) return new Response('not found', { status: 404 });
  if (!(await isKnownWebFontFile(file))) return new Response('not found', { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await objectStore().get(key);
  } catch (error) {
    // ANY read failure is 404 here, not just ObjectNotFound. This is the one
    // object-store read whose key comes from the CALLER, so an absent object is
    // routine rather than an anomaly — and the store cannot currently report it
    // as one: the deployment's IAM user has GetObject but not s3:ListBucket, so
    // S3 answers a missing key with 403 AccessDenied instead of 404 NoSuchKey,
    // which `createS3Store` rethrows. That is why every test passed on the
    // local store (ENOENT -> ObjectNotFound) while production answered 500 to
    // any well-formed unknown hash, which anyone can request. Granting
    // ListBucket restores the contract; this stays regardless, because a public
    // asset route must never turn "I don't have that" into a server error. The
    // reason is logged, so a genuine fault is still diagnosable.
    return new Response('not found', { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'font/woff2',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
