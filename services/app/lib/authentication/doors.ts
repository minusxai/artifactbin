/**
 * THE DOORS: the bearer/cookie route wrapper and the browser and request guards.
 *
 * All bearer failures — missing, malformed, unknown, revoked — are a uniform
 * 401 so a token guesser learns nothing, and an explicit bearer that does not
 * resolve never falls back to a cookie identity. The operator's secret is
 * lib/admin-auth's, with its own uniform 404.
 */
import { isCrossSiteRequest, json, unauthorized } from '../http';
import type { Harness } from '@/lib/accounts';
import { matchesWorkspaceAccount, type RequestIdentity, type TokenHoldingActor } from '@/lib/accounts';
import { isCookieCredential, resolveRequestIdentity, requestOrSessionActor, sessionActor } from './request-identity';

/** The identity a token door admits: always a token, the presented bearer or the browser's agent cookie. */
export type TokenIdentity = RequestIdentity & TokenHoldingActor;

interface TokenContext {
  /** The request's whole resolved identity — pass it on unchanged; never rebuild it from its ids. */
  actor: TokenIdentity;
  /** Declared HTTP client identity remembered on the bearer token. */
  clientHarness: Harness | null;
  params: Record<string, string>;
}

type TokenHandler = (request: Request, ctx: TokenContext) => Promise<Response>;

const holdsToken = (actor: RequestIdentity): actor is TokenIdentity => !!actor.tokenId;

/**
 * THE TOKEN DOOR. Two ways to present the same capability: an AGENT sends the token as a bearer header; a
 * BROWSER sends the httpOnly cookie that names it (lib/agent-session). Both resolve to one live token row
 * (lib/authentication request-identity), so a route written for agents serves the app's own editor unchanged —
 * which is what lets the browser hold no secret at all.
 *
 * Bearer wins when both are present: it is the explicit credential for THIS call, while a cookie merely
 * rides along. An account session alone holds no token and is the uniform 401 here.
 *
 * The Origin check applies to COOKIE-authorized mutations only. A browser always sends Origin/Sec-Fetch-Site
 * (the browser sets them; page script cannot forge them), so a cross-site POST riding the cookie is CSRF and
 * is refused. A bearer call sends no Origin at all — an agent curling the API must never be blocked by a
 * header it has no reason to send.
 */
export function withTokenAuth(handler: TokenHandler, options: {readOnly?:boolean} = {}) {
  return async (
    request: Request,
    routeCtx?: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    // An explicit dry run is a QUESTION — "would this work?" — and on this door it leaves no trace.
    const dryRun=['GET','HEAD'].includes(request.method)&&request.headers.get('X-Artifactbin-Dry-Run')==='1';
    const resolved=await resolveRequestIdentity(request,'token',{dryRun,readOnly:options.readOnly});
    if(resolved.kind==='bearer-invalid')return unauthorized(request);
    if(resolved.kind==='refused')return resolved.response;
    const actor=resolved.identity;
    if (!holdsToken(actor)) return unauthorized(request);
    // A cookie authorizes a mutation only from our own site.
    if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
    const account=actor.userId??actor.tokenId;
    const expectedAccount=request.headers.get('X-Artifactbin-Account');
    if(expectedAccount&&!await matchesWorkspaceAccount(expectedAccount,account))return json({error:'account_mismatch',expected_account:expectedAccount,actual_account:account,hint:'Use the credentials for this workspace account.'},409);
    const params = routeCtx ? await routeCtx.params : {};
    const response=await handler(request, { actor, clientHarness: resolved.clientHarness, params });
    const headers=new Headers(response.headers);
    headers.set('X-Artifactbin-Account',expectedAccount||account);
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
}

/**
 * The request door as a guard (the dataset routes): an explicit bearer or the browser's credentials, the same
 * cross-site refusal, and the uniform 401 for nobody. Returns the actor, or the Response to answer with.
 */
export async function requestActor(request: Request): Promise<RequestIdentity | Response> {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  return actor.userId || actor.tokenId ? actor : unauthorized(request);
}

const isMutation=(request:Request):boolean=>!['GET','HEAD','OPTIONS'].includes(request.method.toUpperCase());

/**
 * The browser-credential guard for session routes (/api/my/*): an account
 * session or the agent-session cookie, plus the same cross-site refusal.
 * Returns the actor, or the Response to answer with.
 */
export async function browserActor(request: Request): Promise<RequestIdentity | Response> {
  const actor = await sessionActor(request);
  if (!actor.userId && !actor.tokenId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  return actor;
}

/**
 * THE same-site rule, keyed on HOW the caller authenticated: a cookie-borne
 * mutation from a cross-site Origin is refused; a bearer (agents send no
 * Origin) and the credential-less served document (opaque origin) never are.
 */
export function refusesCrossSite(request: Request, actor: Pick<RequestIdentity, 'credential'>): boolean {
  return isCookieCredential(actor) && isMutation(request) && isCrossSiteRequest(request);
}
