import { refLoaderForActor } from '@/lib/artifacts';
import { datasetResolverForActor, runDocumentDataflow } from '@/lib/document-data';
import { requestOrSessionActor } from '@/lib/authentication';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { parseJsx } from '@/lib/jsx';
import { syntaxErrorDetail } from '@/lib/jsx/syntax-error';
import { validateHelmet } from '@/lib/document';
import { parseQueryRequest } from '@/lib/http/query-request';
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
  // An agent's bearer, else the BROWSER's credential — the owner editing their own doc runs its draft
  // queries here. Anything but a bearer is cookie-authenticated, so a cross-site caller riding it is CSRF
  // (this compiles and runs the caller's markup).
  const actor = await requestOrSessionActor(request);
  if (actor.credential !== 'bearer' && isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId && !actor.tokenId) return unauthorized(request);

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

  const authorize=async()=>{
    const current=await requestOrSessionActor(request,{revalidate:true});
    if(current.tokenId!==actor.tokenId||current.userId!==actor.userId)throw new DatasetError('Query access revoked',403);
  };
  try {
    const flow = await runDocumentDataflow(markup, refLoaderForActor(actor), datasetResolverForActor(actor), {...parsed,authorize,signal:request.signal});
    await authorize();
    // The compiled declarations ride along: the editor's canvas binds a draft the browser cannot compile.
    return json({ tables: flow?.state.tables ?? {}, errors: flow?.state.errors ?? {}, flow: flow?.flow ?? null },200,{[REVALIDATE_ACTOR_HEADER]:'1'});
  } catch (error) {
    if (error instanceof DatasetError) return json({error:'query_access_revoked'},error.status,{'Cache-Control':'no-store'});
    throw error;
  }
}
