import { requestOrSessionActor } from '@/lib/authentication';
import { isCrossSiteRequest, json, readJson, unauthorized, parseQueryRequest } from '@/lib/http';

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

  return json({error:'native_html_required'},400,{'Cache-Control':'no-store'});
}
