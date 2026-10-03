/**
 * GET /api/page/frame/:id — a FRESH first URL for a document's frame (APP__PAGES_HOST), for an app page
 * that builds the frame itself rather than adopting the one the server drew (brief B's framed story):
 * `{ src, origin }`, where `src` is the pages session exchange carrying a one-time ticket for THIS reader
 * (lib/accounts/pages-sessions) and redirecting to `origin`, the document's own. Same read ACL as the
 * page; a document the reader may not read, or a deployment without a pages host, is the uniform 404.
 * Never cached, and readable only by the app's own origin (no CORS; a pages origin is refused before
 * it gets here, server/pages-host).
 */
import { json } from '@/lib/http';
import { framedDocumentSrc } from '@/lib/serving/artifact-page';
import { PAGES_SITE } from '@/lib/serving/pages-origin';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const frame = PAGES_SITE ? await framedDocumentSrc(request, id, PAGES_SITE) : null;
  return frame ? json(frame, 200, { 'Cache-Control': 'no-store' }) : json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' });
}
