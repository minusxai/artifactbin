/**
 * GET /api/page/frame/:id — a FRESH first URL for a document's frame (APP__PAGES_HOST), for an app page
 * that builds the frame itself rather than adopting the one the server drew (brief B's framed story):
 * `{ src, origin }`, where `src` is the pages session exchange carrying a one-time ticket for THIS reader
 * (lib/accounts/pages-sessions, with the reader's once-grants carried) and redirecting to `origin`, the document's own. Same read ACL as the
 * page; a document the reader may not read is the uniform 404.
 * Never cached, and readable only by the app's own origin (no CORS; a pages origin is refused before
 * it gets here, server/pages-host).
 */
import { json } from '@/lib/http';
import { framedDocumentSrc } from '@/lib/serving/artifact-page';
import { pagesSite } from '@/lib/http/pages-origin';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // This request's own query is the app page's (`/api/page/frame/<id>${location.search}`): the reader's `$` values
  // ride into the frame's first URL exactly as the served page's did.
  const frame = await framedDocumentSrc(request, id, pagesSite(), new URL(request.url).search);
  return frame ? json(frame, 200, { 'Cache-Control': 'no-store' }) : json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' });
}
