import { datasetResolverForActor, runDocumentDataflow } from '@/lib/artifacts';
import { actorForArtifacts, sessionActor } from '@/lib/viewer';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { parseJsx } from '@/lib/jsx';
import { syntaxErrorDetail } from '@/lib/jsx/syntax-error';
import { validateHelmet } from '@/lib/story/helmet';
import { parseQueryRequest } from '@/lib/story/query-request';
import { resolveToken } from '@/lib/tokens';
import {DatasetError} from '@/lib/datasets/errors';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';

/**
 * POST /api/query { markup, values?, only? } → { tables, errors }
 *
 * The OWNER path of the query relay: the editor running a DRAFT's `<Query>`s
 * — a query typed a moment ago has never been stored, so there is no artifact
 * to ask. Requires a credential — a bearer token OR either browser credential
 * (an account session or the agent-session cookie, like /api/preview) — and
 * reads datasets by that actor's ownership only (a foreign `ref_<id>` is a
 * missing table, never data). Nothing is persisted.
 */
export async function POST(request: Request) {
  const bearer = request.headers.get('authorization') ?? '';
  const presented = bearer.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : '';
  const token = presented ? await resolveToken(presented) : null;
  let actor: { tokenId: string; userId: string | null } | null = token ? { tokenId: token.id, userId: token.userId } : null;
  if (!actor) {
    // The BROWSER's credential — the anonymous owner editing their own doc runs
    // its draft queries here. Cookie-authenticated, so a cross-site caller
    // riding it is CSRF (this compiles and runs the caller's markup).
    if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
    actor = actorForArtifacts(await sessionActor(request));
    if (!actor) return unauthorized(request);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.markup !== 'string') return json({ error: 'markup_required' }, 400);
  const { markup, ...queryRequest } = body;
  const parsed = parseQueryRequest(queryRequest);
  if (parsed instanceof Response) return parsed;

  // A malformed Helmet cannot be run: report the grammar, as publish would.
  const tree = parseJsx(markup);
  if (!tree.ok) return json({ error: 'invalid_jsx', details: [syntaxErrorDetail(markup, tree)] }, 400);
  const helmetErrors = validateHelmet(tree.nodes);
  if (helmetErrors.length) return json({ error: 'invalid_jsx', details: helmetErrors }, 400);

  const admittedActor=actor;
  const authorize=async()=>{
    const currentToken=presented?await resolveToken(presented):null;
    const current=presented?(currentToken?{tokenId:currentToken.id,userId:currentToken.userId}:null):actorForArtifacts(await sessionActor(request));
    if(!current||current.tokenId!==admittedActor.tokenId||current.userId!==admittedActor.userId)throw new DatasetError('Query access revoked',403);
  };
  try {
    const flow = await runDocumentDataflow(markup, datasetResolverForActor(actor), {...parsed,authorize,signal:request.signal});
    await authorize();
    return json({ tables: flow?.state.tables ?? {}, errors: flow?.state.errors ?? {} },200,{[REVALIDATE_ACTOR_HEADER]:'1'});
  } catch (error) {
    if (error instanceof DatasetError) return json({error:'query_access_revoked'},error.status,{'Cache-Control':'no-store'});
    throw error;
  }
}
