/**
 * CONTENT ENCODING — which bytes a response carries for the encodings its
 * request accepts. One module, two sources of compressed bytes:
 *
 *  - STATIC, content-addressed trees (/assets, /islands, /libraries, /offline):
 *    the brotli/gzip siblings the build wrote beside each file
 *    (scripts/lib/precompress.mjs). Chosen per request, never computed.
 *  - DYNAMIC pages and page data: brotli at a fast quality, computed per
 *    response, only for a finished HTML/JSON body (`compressDynamic`).
 *
 * Invariants for both: a variant is sent only when the request accepts its
 * encoding; every response that could have been encoded says
 * `Vary: Accept-Encoding`; an already-encoded body and a stream are never
 * touched; Range stays on the identity bytes. A client that sends no
 * Accept-Encoding (a scripted session, curl without --compressed) gets identity.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { Context, MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

type ServeStaticOptions = Parameters<typeof serveStatic>[0];
const SIBLING = /\.(?:br|gz)$/;
/** The content types a sibling can exist for (scripts/lib/precompress PRECOMPRESSIBLE). */
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:javascript|json|wasm|manifest\+json)|image\/svg\+xml)/i;

/** Add `Accept-Encoding` to a response's Vary, once. */
export function varyOnEncoding(headers: Headers): void {
  const vary = headers.get('vary');
  if (!vary) headers.set('vary', 'Accept-Encoding');
  else if (!/(?:^|,)\s*(?:accept-encoding|\*)\s*(?:,|$)/i.test(vary)) headers.set('vary', `${vary}, Accept-Encoding`);
}

/**
 * The static handler for a tree the build precompressed. A request with Range
 * is served from the identity file, as before; every other GET/HEAD takes the
 * best sibling the request accepts (Hono's `precompressed`: brotli, then gzip,
 * matching exact tokens, so a `br;q=0` never receives brotli). The siblings
 * themselves are not addressable.
 */
export function precompressedStatic(options: NonNullable<ServeStaticOptions>): MiddlewareHandler {
  const encoded = serveStatic({ ...options, precompressed: true });
  const plain = serveStatic(options);
  const root = options.root ?? '';
  return async (c, next) => {
    if (SIBLING.test(c.req.path)) {
      const requested = options.rewriteRequestPath ? options.rewriteRequestPath(c.req.path, c) : c.req.path;
      const source = path.join(root, requested.replace(SIBLING, ''));
      if ((await stat(source).catch(() => null))?.isFile()) return next();
    }
    const response = await (c.req.header('range') ? plain : encoded)(c, next);
    // A miss falls through to `next`, whose resolution is not this file's response.
    if (response instanceof Response && COMPRESSIBLE_TYPE.test(response.headers.get('content-type') ?? '')) varyOnEncoding(response.headers);
    return response;
  };
}

/**
 * The encoding to send, from the request's Accept-Encoding and the encodings
 * on offer (in preference order), honouring q-values: `br;q=0` refuses brotli,
 * `*` admits anything not named. Null means identity.
 */
export function negotiateEncoding(accept: string | null | undefined, offered: readonly string[]): string | null {
  if (!accept) return null;
  const weights = new Map<string, number>();
  for (const part of accept.split(',')) {
    const [token = '', ...params] = part.trim().toLowerCase().split(';');
    if (!token) continue;
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    const weight = q ? Number(q.slice(2)) : 1;
    weights.set(token.trim(), Number.isFinite(weight) ? weight : 0);
  }
  let best: string | null = null;
  let bestWeight = 0;
  for (const encoding of offered) {
    const weight = weights.get(encoding) ?? weights.get('*') ?? 0;
    if (weight > bestWeight) { best = encoding; bestWeight = weight; }
  }
  return best;
}

/** Precomputed variants of one in-memory immutable body (the offline extras). */
export interface EncodedVariants { br?: Buffer; gzip?: Buffer }

/**
 * An in-memory immutable body as the response the request accepts: a
 * precomputed variant when one is offered and accepted, identity otherwise.
 * HEAD carries the chosen variant's headers and no body.
 */
export function variantResponse(c: Context, body: Buffer, variants: EncodedVariants, headers: Record<string, string>): Response {
  const encoding = negotiateEncoding(c.req.header('accept-encoding'), (['br', 'gzip'] as const).filter(e => variants[e]));
  const bytes = encoding ? variants[encoding as 'br' | 'gzip']! : body;
  const out = new Headers(headers);
  if (encoding) out.set('content-encoding', encoding);
  varyOnEncoding(out);
  out.set('content-length', String(bytes.byteLength));
  return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(bytes), { status: 200, headers: out });
}

const brotli = promisify(zlib.brotliCompress);
/**
 * The quality for per-request brotli. 5 is the measured knee on real documents
 * (see the report): most of quality 11's saving at a small fraction of its CPU,
 * and smaller than nginx's on-the-fly gzip.
 */
export const DYNAMIC_BROTLI_QUALITY = 5;
/** Below this, compression cannot pay for its own framing. */
const DYNAMIC_MIN_BYTES = 1024;
const DYNAMIC_TYPE = /^(?:text\/html|application\/json)\b/i;

/**
 * A finished page or page-data response, brotli-encoded when the request
 * accepts it. Everything else passes through untouched: HEAD, non-HTML/JSON,
 * event streams, an existing Content-Encoding, a body too small to gain.
 * Compression runs on zlib's thread pool, never the event loop.
 */
export async function compressDynamic(request: Request, response: Response): Promise<Response> {
  const type = response.headers.get('content-type') ?? '';
  if (!DYNAMIC_TYPE.test(type) || response.headers.has('content-encoding') || !response.body) return response;
  varyOnEncoding(response.headers);
  if (request.method === 'HEAD' || negotiateEncoding(request.headers.get('accept-encoding'), ['br']) !== 'br') return response;
  const source = Buffer.from(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  if (source.byteLength < DYNAMIC_MIN_BYTES) {
    headers.set('content-length', String(source.byteLength));
    return new Response(new Uint8Array(source), { status: response.status, statusText: response.statusText, headers });
  }
  const encoded = await brotli(source, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: DYNAMIC_BROTLI_QUALITY,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
  } });
  headers.set('content-encoding', 'br');
  headers.set('content-length', String(encoded.byteLength));
  return new Response(new Uint8Array(encoded), { status: response.status, statusText: response.statusText, headers });
}

/** `compressDynamic` as middleware, for a route family whose every answer is finished JSON (/api/page/*). */
export const dynamicEncoding = (): MiddlewareHandler => async (c, next) => {
  await next();
  const encoded = await compressDynamic(c.req.raw, c.res);
  if (encoded === c.res) return;
  // Hono merges a replaced response's old headers INTO the new one; the old length would describe the wrong bytes.
  c.res = undefined;
  c.res = encoded;
};
