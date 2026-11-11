/**
 * GET /af/url-space.json — the URL map (`@artifactbin/contracts` url-space): what every path on this origin is, for a
 * proxy, a co-hosted router or a custom shell that would rather read it than keep its own list. Public bytes that
 * change only with a deploy: revalidated by a strong ETag, like the other `/af/` documents.
 */
import { createHash } from 'node:crypto';
import { URL_SPACE } from '@artifactbin/contracts';
import { matchingTag } from '@/lib/http';

const body = JSON.stringify(URL_SPACE);
const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;

export function GET(request: Request): Response {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', etag, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
  if (matchingTag(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
export const HEAD = GET;
