import { canReadArtifact, dataflowForRow, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import { json, readJson } from '@/lib/http';
import { sessionActor } from '@/lib/viewer';
import { parseQueryRequest, type QueryRequest } from '@/lib/story/query-request';
import { QUERY_REQUEST_PARAM } from '@/lib/story-runtime/contract';

/**
 * GET  /a/<id>/query?q=<JSON {values?, only?, page?}> → { tables, errors }
 * POST /a/<id>/query     { values?, only?, page? }    → { tables, errors }
 *
 * Two doors to one run. Values are the reader's current selections; `only`
 * the queries the change touched (the run closes over their dependencies);
 * `page` a window of one result. Nothing is persisted.
 *
 * GET is the DOCUMENT's own path: the sandboxed document served top-level
 * (proxy.ts) fetches its re-runs itself — its CSP admits exactly this URL
 * (lib/story/markup-csp). It is answered with the ANONYMOUS read ACL, BY
 * CONSTRUCTION: no cookie is read, so it can only ever return what an
 * unauthenticated fetch gets (public/unlisted; a private document is the
 * uniform 404). That, not browser behaviour, is what makes the CORS `*` safe —
 * the document's origin is opaque and its request carries nothing, but even a
 * credential arriving here would change nothing.
 *
 * POST is the READER path inside the owner's shell: the PAGE (which holds the
 * session) calls it on the frame's behalf and posts the result back
 * (components/ArtifactSurface). Same read ACL as the page and `raw` — a
 * document you cannot read, you cannot query: uniform 404. This is the only
 * way a PRIVATE document's queries run for its readers.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404);
  // Anonymous viewer, always — see above. Never sessionViewer() here.
  if (!(await canReadArtifact(artifact, null))) return json({ error: 'not_found' }, 404);

  const raw = new URL(request.url).searchParams.get(QUERY_REQUEST_PARAM);
  if (raw === null) return json({ error: 'invalid_json', details: [`${QUERY_REQUEST_PARAM} must be the JSON of {values?, only?, page?}`] }, 400);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_json', details: [`${QUERY_REQUEST_PARAM} must be the JSON of {values?, only?, page?}`] }, 400);
  }
  const parsed = parseQueryRequest(body as Record<string, unknown>);
  if (parsed instanceof Response) return parsed;
  // no-store: an edit changes the answer, and the document asks again anyway.
  return answer(artifact, parsed, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404);
  // The SAME viewer as the page, raw and the proxy (NextAuth, then the agent
  // cookie) — anything narrower splits the shell from its document: a browser
  // whose cookie names a CLAIMED token would own the page and be a stranger
  // here, its own private document's queries 404ing inside the frame.
  const viewer = (await sessionActor(request)).viewer;
  if (!(await canReadArtifact(artifact, viewer))) return json({ error: 'not_found' }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const parsed = parseQueryRequest(body);
  if (parsed instanceof Response) return parsed;
  return answer(artifact, parsed);
}

/** The run itself, shared by both doors. */
async function answer(artifact: ArtifactRow, parsed: QueryRequest, extra: Record<string, string> = {}): Promise<Response> {
  if (artifact.format !== 'markup') return json({ tables: {}, errors: {} }, 200, extra);
  const flow = await dataflowForRow(artifact, parsed);
  return json({ tables: flow?.state.tables ?? {}, errors: flow?.state.errors ?? {} }, 200, extra);
}
