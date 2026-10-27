/**
 * REVALIDATION — the validators a document answers with, so a repeat view of one that did not change costs a
 * header, not the page.
 *
 * A page that cannot be cached (`no-store`, as every document was) is rendered and sent whole on every view. These
 * answers are cached PRIVATELY and revalidated every time: `Cache-Control: private, no-cache` plus a STRONG `ETag` over
 * everything that determines the bytes, so `If-None-Match` is answered 304 before anything is rendered.
 *
 * The tag is a hash of the facts the caller names — never the bytes, which are what the 304 exists not to make. A
 * fact left out is a stale 304, so the caller names every input of the answer: the version and edit, who is asking and
 * in what role, what that reader trusts, the build and stylesheets it runs on, the data the page starts from. Nothing
 * here is shared between readers: `private`, and the viewer is in the facts, so another reader's tag never matches.
 */
import { createHash } from 'node:crypto';

/** What a revalidated answer is cached as: by this browser only, and checked on every use. */
export const REVALIDATE = 'private, no-cache';

/** JSON with sorted keys and no `undefined`, so equal facts are equal text whatever order they were built in. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item === undefined ? null : item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

/** A strong ETag over `facts`: 128 bits of their hash. */
export function etagOf(facts: unknown): string {
  return `"${createHash('sha256').update(canonical(facts)).digest('base64url').slice(0, 22)}"`;
}

/** The tag of the representation sent in `encoding`: one validator per body, as a strong tag must be. */
export function withEncoding(etag: string, encoding: string | null): string {
  return encoding ? `${etag.slice(0, -1)}-${encoding}"` : etag;
}

/** The tag a request's validator names, without its weakness mark or the encoding it was sent in. */
const bare = (tag: string): string => tag.trim().replace(/^W\//, '').replace(/-(?:br|gzip)"$/, '"');

/**
 * The validator `If-None-Match` presented that names `etag` (weak comparison, as the spec has it for this header),
 * as the client sent it — the representation it holds — or `etag` itself for `*`; null when it names none.
 */
export function matchingTag(header: string | null | undefined, etag: string): string | null {
  if (!header) return null;
  if (header.trim() === '*') return etag;
  const hit = header.split(',').find((tag) => /^"[^"]*"$/.test(bare(tag)) && bare(tag) === etag);
  return hit ? hit.trim().replace(/^W\//, '') : null;
}

/** The validator headers of a revalidated answer. */
export const revalidationHeaders = (etag: string): Record<string, string> => ({ ETag: etag, 'Cache-Control': REVALIDATE });

/** The 304: the validator (the client's own, naming the body it holds) and the caching rule again, no body. */
export function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { ...revalidationHeaders(etag), Vary: 'Accept-Encoding' } });
}

/**
 * Public platform bytes at a stable address (/af/core.js, /af/apollo.js, /af/reader.js, /af/styles.css, …): no version
 * or hash in the URL, so every load revalidates (`no-cache`) against a strong ETag over the bytes and a deploy shows up
 * on the next load. `If-None-Match` → 304; HEAD answers the headers only. No viewer input reaches these bytes.
 */
const publicTags = new Map<string, string>();
export function publicRevalidatedResponse(request: Request, body: string, contentType: string): Response {
  let etag = publicTags.get(body);
  if (!etag) { etag = `"${createHash('sha256').update(body).digest('hex')}"`; if (publicTags.size > 32) publicTags.clear(); publicTags.set(body, etag); }
  const headers: Record<string, string> = { 'content-type': contentType, 'cache-control': 'no-cache', etag, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
  if (matchingTag(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  headers['content-length'] = String(Buffer.byteLength(body));
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
