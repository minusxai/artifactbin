/**
 * The document as a live frame — what a client fetches after a version ping.
 * Same read ACL as the page, `raw` and the stream (uniform 404); cached per
 * (id, edit_id) in lib/story/frame. CORS-open like `query`, since the served
 * document (opaque origin) fetches it directly.
 */
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import { liveFrameFor } from '@/lib/story/frame';
import { sessionActor } from '@/lib/viewer';

/**
 * A FRESH object per response, never this one. The Node server writes the
 * computed `Content-Length` back INTO the object a route hands to `new
 * Response`, so a shared constant makes every later response announce the
 * FIRST body's length — the browser then drops it (ERR_CONTENT_LENGTH_MISMATCH)
 * and the connection's framing is corrupt for whatever follows. Pinned by
 * server/__tests__/content-length.test.ts.
 */
const headers = (): Record<string, string> => ({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response('not found', { status: 404 });
  const row = await getArtifactById(id);
  if (!row) return new Response('not found', { status: 404 });
  const actor = await sessionActor(request);
  if (!(await canReadArtifact(row, actor.viewer))) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(await liveFrameFor(row)), { headers: headers() });
}
