import { createHash } from 'node:crypto';
import { AUTHOR_FRAME_DOCUMENT } from '@/lib/story-runtime/author-frame';
import { libraryUrls } from '@/lib/libraries';

/** Fixed wrapper bytes only; author-controlled content is transferred later over a MessagePort. */
export function authorFrameResponse(request: Request, assetsOrigin: string | null, main: string): Response {
  const ids = new URL(request.url).searchParams.getAll('artifact');
  if (ids.length > 1 || (ids.length === 1 && !/^[A-Za-z0-9]{6}$/.test(ids[0]))) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const resolver = ids.length ? ` ${main}/a/${ids[0]}/resolve` : '';
  const asset = assetsOrigin ? ` ${assetsOrigin}` : '';
  const csp = ["default-src 'none'", 'sandbox allow-scripts', `script-src 'unsafe-inline'${asset} ${Object.values(libraryUrls(main)).join(' ')}`, `connect-src${asset}${resolver} blob: data:`, `img-src data: blob:${asset}`, `media-src data: blob:${asset}`, `font-src data:${asset}`, "style-src 'unsafe-inline'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "object-src 'none'", "base-uri 'none'"].join('; ');
  const etag = `"${createHash('sha256').update(csp).update(AUTHOR_FRAME_DOCUMENT).digest('hex')}"`;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cache-control': 'public, max-age=0, must-revalidate', etag };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : AUTHOR_FRAME_DOCUMENT, { headers });
}
