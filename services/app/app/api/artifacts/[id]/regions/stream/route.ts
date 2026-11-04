/** GET /api/artifacts/:id/regions/stream?after=<regionId>:<seq>,... — the editors' stream (lib/region-sessions stream). */
import { json } from '@/lib/http';
import { browserEditor, notFound, regionSessions } from '../doors';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserEditor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const opened = await regionSessions().stream(actor, id, new URL(request.url).searchParams.get('after'), request.signal);
  if (opened.status === 'not_found') return notFound();
  if (opened.status === 'invalid') return json({ error: 'invalid_cursor' }, 400);
  if (opened.status === 'busy') return new Response('too many live documents', { status: 503, headers: { 'Retry-After': '30' } });
  return new Response(opened.stream, { headers: SSE_HEADERS });
}
