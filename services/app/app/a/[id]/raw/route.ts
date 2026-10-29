/**
 * GET /a/:id/raw — the artifact's own bytes, answered by lib/document-serving (its sandbox, ACL and cache policy).
 *
 * Why a route handler and not a query string on the page: the PATH selects the
 * handler before any query is read, and a page can neither return raw bytes nor
 * set the per-row response headers that the document's sandbox is built from.
 * `?raw=true` on a page could do neither.
 *
 * `domain` (server/custom-host) and `fragment` (app/a/[id]/story) are set only by their callers: the router passes
 * params alone, so no request can ask for either mode.
 */
import { serveRawDocument, type DomainPost, type StoryFragmentRequest } from '@/lib/document-serving';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost; fragment?: StoryFragmentRequest }): Promise<Response> {
  const { id } = await ctx.params;
  return serveRawDocument(request, { id, ...(ctx.domain ? { domain: ctx.domain } : {}), ...(ctx.fragment ? { fragment: ctx.fragment } : {}) });
}

/**
 * HEAD is GET with the body thrown away — a PDF viewer sends one before it
 * starts seeking, to learn the size and whether ranges are served.
 *
 * It runs the real handler rather than a second, shorter one: the ACL, the
 * headers and the 404 must be the same answer, and a parallel implementation of
 * "the same but no body" is exactly where those drift. The PDF case knows it is
 * a HEAD and never opens a stream; every other format pays for a body it then
 * discards — honest, and what a HEAD costs anywhere.
 */
export async function HEAD(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost }) {
  const res = await GET(request, ctx);
  // Cancel rather than leak: an unread stream holds its file handle open.
  await res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: new Headers(res.headers) });
}
