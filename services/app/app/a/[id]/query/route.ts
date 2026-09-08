import { canReadArtifact, dataflowForRow, getArtifactById, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import { json, readJson } from '@/lib/http';
import { sessionActor } from '@/lib/viewer';
import { parseQueryRequest, type QueryRequest } from '@/lib/story/query-request';
import { QUERY_REQUEST_PARAM } from '@/lib/story-runtime/contract';
import { LocalStateInputError } from '@/lib/story/local-tables';

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
  return answer(artifact, parsed, null, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
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
  const actor = await sessionActor(request);
  if (!(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const parsed = parseQueryRequest(body);
  if (parsed instanceof Response) return parsed;
  /*
   * THE TOKEN ID TRAVELS, not only the account. `sessionActor` answers an
   * account session as a `viewer` and the AGENT COOKIE as a bare `tokenId`, and
   * a folder is OWNED by its token when nobody has claimed it — so passing the
   * viewer alone hands an anonymous owner the stranger's view of their own
   * listing: no private children, no counts. Measured on the dev walk, where
   * every artifact belongs to an unclaimed token.
   */
  const cors: Record<string, string> = !actor.viewer && !actor.tokenId ? {'Access-Control-Allow-Origin': '*'} : {};
  return answer(artifact, parsed, { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null }, cors);
}

/**
 * The run itself, shared by both doors.
 *
 * The VIEWER rides in, and that is what separates the two doors' answers where
 * the run depends on who is asking. A folder's children table is computed per
 * viewer (lib/folders childrenTableFor): the GET door passes null and answers
 * the public children, and the POST door passes the session — which is the
 * only way an owner's private children are ever listed. REACH is still the
 * document's own (its <Query> may name only what its owner may read); this is
 * WHICH ROWS come back.
 */
async function answer(artifact: ArtifactRow, parsed: QueryRequest, viewer: RoleActor | null, extra: Record<string, string> = {}): Promise<Response> {
  if (artifact.format !== 'markup' && artifact.format !== 'folder') return json({ tables: {}, errors: {} }, 200, extra);
  let flow;
  try { flow = await dataflowForRow(artifact, { ...parsed, viewer }); }
  catch (error) {
    if (error instanceof LocalStateInputError) return json({error: 'invalid_local_state', detail: error.message}, 400, extra);
    throw error;
  }
  return json({ tables: flow?.state.tables ?? {}, errors: flow?.state.errors ?? {}, ...(flow?.flow.mutations?.length ? {mutationAccess:flow.state.mutationAccess ?? {}} : {}) }, 200, {...extra,'Cache-Control':'no-store'});
}
