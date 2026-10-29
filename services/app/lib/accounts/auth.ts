/**
 * The bearer/cookie route wrapper, and the two in-memory web-ingest allowances
 * it owns.
 *
 * All bearer failures — missing, malformed, unknown, revoked — are a uniform
 * 401 so a token guesser learns nothing, and an explicit bearer that does not
 * resolve never falls back to a cookie identity. The operator's secret is
 * lib/admin-auth's, with its own uniform 404.
 */
import { isCrossSiteRequest, json, unauthorized } from '../http/http';
import {TRUSTED_PROXY_HOPS, WEB_INGEST_MAX_PER_HOUR} from '../platform/config';
import {forwardedFor} from '../platform/client-identity';
import type { Harness } from '@/lib/platform';
import type { RequestIdentity, TokenHoldingActor } from './actors';
import { isCookieCredential, resolveRequestIdentity, sessionActor } from './request-identity';
import { matchesWorkspaceAccount } from './guest-owner';

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

/** Web ingestion counts per-publication URL work, independently of identity. */

/** Test hook — clears the app's in-memory web-ingest quota state. */
export function resetRateLimit(): void {
  resetWebIngestRateLimit();
}

// ── Web-ingest allowance ─────────────────────────────────────────────────────
// Importing an asset makes THIS SERVER fetch a URL, so an identity gets a
// bounded number of fetch ATTEMPTS per hour — attempts, not successes, because
// the abuse shape is probing, and probes fail. A QUOTA, not a rate limit: it is
// counted per URL INSIDE one publish request, which a proxy cannot see.
const WEB_INGEST_WINDOW_MS = 60 * 60 * 1000;
const webIngestTimes = new Map<string, number[]>();

export function webIngestRateLimited(key: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(key, WEB_INGEST_MAX_PER_HOUR, now);
}

/** The most buckets held at once; past it the least recently created are dropped, so the map cannot grow without bound. */
const WEB_INGEST_MAX_KEYS = 50_000;
/** Buckets whose attempts have all aged out are swept this often, not only when their own key is touched again. */
const WEB_INGEST_SWEEP_MS = 60 * 1000;
let nextSweepAt = 0;

function sweepExpiredBuckets(now: number): void {
  if (now < nextSweepAt && webIngestTimes.size <= WEB_INGEST_MAX_KEYS) return;
  nextSweepAt = now + WEB_INGEST_SWEEP_MS;
  for (const [key, times] of webIngestTimes) {
    if (!times.length || now - times[times.length - 1]! >= WEB_INGEST_WINDOW_MS) webIngestTimes.delete(key);
  }
  for (const key of webIngestTimes.keys()) {
    if (webIngestTimes.size <= WEB_INGEST_MAX_KEYS) break;
    webIngestTimes.delete(key);
  }
}

/** Number of live buckets — a test seam for the sweep. */
export function webIngestBucketCount(): number { return webIngestTimes.size; }

/** One hourly ATTEMPT bucket, shared by every allowance in this file. */
function hourlyAttemptsExhausted(key: string, max: number, now: number): boolean {
  sweepExpiredBuckets(now);
  const times = (webIngestTimes.get(key) ?? []).filter((t) => now - t < WEB_INGEST_WINDOW_MS);
  if (times.length >= max) {
    if (times.length) webIngestTimes.set(key, times); else webIngestTimes.delete(key);
    return true;
  }
  times.push(now);
  webIngestTimes.set(key, times);
  return false;
}

/**
 * A DOCUMENT's own hourly ceiling on first-view asset imports
 * (app/a/[id]/assets).
 *
 * Keyed on the document rather than on a caller, because the caller is
 * whichever stranger happens to be reading and the thing being protected is
 * this server's outbound fetching. It is an APP quota and not a proxy policy for
 * the proxy's verdicts are per client IP and it
 * cannot see which document an address names, so "this document has done
 * enough importing for one hour" is a question only the app can ask.
 *
 * Smaller than the per-identity web-ingest allowance by an order of magnitude:
 * a publish imports a document's whole finite set of URLs at once, while this
 * is the tail of what only a reader can compute, and a document that genuinely
 * needs hundreds of distinct images an hour is not the shape this exists for.
 */
const DOC_ASSET_IMPORTS_PER_HOUR = 30;
let docAssetCap: number | null = null;
/** Test hook, mirroring setAssetByteQuotaForTests — the ceiling is a constant. */
export function setDocAssetImportCapForTests(cap: number | null): void { docAssetCap = cap; }

export function docAssetImportRateLimited(id: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(`doc-assets:${id}`, docAssetCap ?? DOC_ASSET_IMPORTS_PER_HOUR, now);
}

/**
 * A document's script reaching a declared host through us (app/a/[id]/fetch): per document AND reader,
 * because the thing protected is this server's outbound fetching on that document's behalf, and one
 * reader's busy dashboard must not exhaust another's.
 */
const DOC_FETCHES_PER_HOUR = 600;
let docFetchCap: number | null = null;
/**
 * Who a document's fetch quota is charged to: the account or token, else the anonymous reader's client IP
 * (the address our trusted proxy saw), so one busy stranger cannot spend every other stranger's allowance.
 */
export function documentFetchReader(actor: { userId?: string | null; tokenId?: string | null }, request: Request): string {
  if (actor.userId ?? actor.tokenId) return (actor.userId ?? actor.tokenId)!;
  const ip = forwardedFor(request.headers, TRUSTED_PROXY_HOPS);
  return ip ? `guest:${ip}` : 'guest';
}

/** Test hook for the per-document fetch ceiling. */
export function setDocumentFetchCapForTests(cap: number | null): void { docFetchCap = cap; }
export function documentFetchRateLimited(id: string, reader: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(`doc-fetch:${id}:${reader}`, docFetchCap ?? DOC_FETCHES_PER_HOUR, now);
}

export function resetWebIngestRateLimit(): void {
  webIngestTimes.clear();
  nextSweepAt = 0;
}

/**
 * THE TOKEN DOOR. Two ways to present the same capability: an AGENT sends the token as a bearer header; a
 * BROWSER sends the httpOnly cookie that names it (lib/agent-session). Both resolve to one live token row
 * (lib/accounts request-identity), so a route written for agents serves the app's own editor unchanged —
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
