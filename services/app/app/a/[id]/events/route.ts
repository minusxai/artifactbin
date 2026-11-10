/**
 * GET /a/:id/events — the document's live stream (lib/publish/realtime/document-events), as Server-Sent Events.
 * Anyone who may read the page may watch it change; everyone else gets the uniform 404.
 */
import { documentEventBody } from './composition';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
  /*
   * The DOCUMENT listens on this too (lib/story-runtime/live-entry), and a
   * served document is sandboxed without `allow-same-origin` even when it
   * is what the reader is looking at — so its origin is "null" and its own
   * stream is a cross-origin request to it.
   *
   * Safe for exactly the reason the query endpoint's is (app/a/[id]/query):
   * an opaque-origin request carries NO cookies, so this answers it as a
   * stranger — a public document streams, a private one is the uniform 404
   * — and `*` cannot hand a third-party site anything it could not fetch
   * for itself anyway. The owner's page, being same-origin, is unaffected.
   */
  'Access-Control-Allow-Origin': '*',
};

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await documentEventBody(request, id);
  return body instanceof Response ? body : new Response(body, { headers: { ...SSE_HEADERS } });
}
