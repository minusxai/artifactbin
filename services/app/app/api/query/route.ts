import { datasetResolverForActor, runDocumentDataflow } from '@/lib/artifacts';
import { actorForArtifacts, sessionActor } from '@/lib/viewer';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { parseJsx } from '@/lib/jsx';
import { validateHelmet } from '@/lib/story/helmet';
import { parseQueryRequest } from '@/lib/story/query-request';
import { resolveToken } from '@/lib/tokens';

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
  const parsed = parseQueryRequest(body);
  if (parsed instanceof Response) return parsed;

  // A malformed Helmet cannot be run: report the grammar, as publish would.
  const tree = parseJsx(body.markup);
  if (!tree.ok) return json({ error: 'invalid_jsx', details: [{ message: `JSX syntax error: ${tree.error}` }] }, 400);
  const helmetErrors = validateHelmet(tree.nodes);
  if (helmetErrors.length) return json({ error: 'invalid_jsx', details: helmetErrors }, 400);

  const flow = await runDocumentDataflow(body.markup, datasetResolverForActor(actor), parsed);
  return json({ tables: flow?.state.tables ?? {}, errors: flow?.state.errors ?? {} });
}
