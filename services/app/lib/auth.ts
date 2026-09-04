/**
 * Route auth wrappers. (Shape from minusx lib/http/with-remote-session-auth.ts;
 * admin-secret discipline from minusx-gateway admin_api.py.)
 *
 * All bearer failures — missing, malformed, unknown, revoked — are a uniform
 * 401 so a token guesser learns nothing. Admin-secret failures are a uniform
 * 404: for anyone without the secret, the endpoint does not exist. Both fail
 * closed when their configuration is unset.
 */
import { TRUSTED_PROXY_HOPS, WEB_INGEST_MAX_PER_HOUR } from './config';
import { ARTIFACTBIN_AGENT_HEADER, forwardedFor, identifyClient } from './client-identity';
import { isCrossSiteRequest, json, unauthorized } from './http';
import { rememberTokenClient, resolveToken, touchToken } from './tokens';
import { sessionActor } from './viewer';
import type { RequestActor } from './viewer';
import type { Harness } from './client-identity';

import type { Credential } from '@artifactbin/contracts';
import { isCookieCredential } from './viewer';

export interface TokenContext {
  tokenId: string;
  /** Owner of the token, or null while it's anonymous (unclaimed). */
  userId: string | null;
  /** How this call proved itself; used only to choose owner vs agent display attribution. */
  credential: Credential;
  /** Declared HTTP or MCP initialize identity remembered on the bearer token. */
  clientHarness: Harness | null;
  params: Record<string, string>;
}

type TokenHandler = (request: Request, ctx: TokenContext) => Promise<Response>;

/*
 * A DOOR IS ENFORCED IN EXACTLY ONE PLACE (P2 §H): every door the proxy's
 * doorFor() maps — ANON_MINT, MUTATE, PUBLISH, QUERY, EDIT, EXPORT, the LOGIN
 * and OAUTH ones — is counted by the PROXY, before the request is forwarded.
 * The app helpers that used to count the same doors in the same process are
 * gone (they halved every configured ceiling); what stays below is a QUOTA,
 * counted per URL inside one publish, which no proxy can see. Guarded by
 * lib/__tests__/doors-one-place.test.ts.
 */

/** Test hook — clears the app's in-memory web-ingest quota state. */
export function resetRateLimit(): void {
  resetWebIngestRateLimit();
}

// ── Web-ingest allowance ─────────────────────────────────────────────────────
// Importing an asset makes THIS SERVER fetch a URL, so an identity gets a
// bounded number of fetch ATTEMPTS per hour — attempts, not successes, because
// the abuse shape is probing, and probes fail. A QUOTA, not a door: it is
// counted per URL INSIDE one publish request, which a proxy cannot see.
const WEB_INGEST_WINDOW_MS = 60 * 60 * 1000;
const webIngestTimes = new Map<string, number[]>();

export function webIngestRateLimited(key: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(key, WEB_INGEST_MAX_PER_HOUR, now);
}

/** One hourly ATTEMPT bucket, shared by every allowance in this file. */
function hourlyAttemptsExhausted(key: string, max: number, now: number): boolean {
  const times = (webIngestTimes.get(key) ?? []).filter((t) => now - t < WEB_INGEST_WINDOW_MS);
  if (times.length >= max) {
    webIngestTimes.set(key, times);
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
 * this server's outbound fetching. It is an APP quota and not a proxy door for
 * the reason CLAUDE.md gives — the proxy's verdicts are per client IP and it
 * cannot see which document an address names, so "this document has done
 * enough importing for one hour" is a question only the app can ask.
 *
 * Smaller than the per-identity web-ingest allowance by an order of magnitude:
 * a publish imports a document's whole finite set of URLs at once, while this
 * is the tail of what only a reader can compute, and a document that genuinely
 * needs hundreds of distinct images an hour is not the shape this exists for.
 */
export const DOC_ASSET_IMPORTS_PER_HOUR = 30;
let docAssetCap: number | null = null;
/** Test hook, mirroring setAssetByteQuotaForTests — the ceiling is a constant. */
export function setDocAssetImportCapForTests(cap: number | null): void { docAssetCap = cap; }

export function docAssetImportRateLimited(id: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(`doc-assets:${id}`, docAssetCap ?? DOC_ASSET_IMPORTS_PER_HOUR, now);
}

export function resetWebIngestRateLimit(): void {
  webIngestTimes.clear();
}

/**
 * WHO is being rate-limited. Identity is the whole valve: a caller who can
 * choose their own key has no limit at all.
 *
 * `X-Forwarded-For` is a list that each hop APPENDS to, so it reads
 * `<whatever the client sent>, <what proxy1 saw>, <what proxy2 saw>, …`. The
 * address our outermost TRUSTED proxy observed therefore sits `hops` from the
 * END; everything left of that is text the caller typed. Reading `[0]` — the
 * intuitive choice, and the one this used to make — hands every caller a fresh
 * bucket per request behind exactly the appending proxies (Caddy, Traefik,
 * nginx's `$proxy_add_x_forwarded_for`) that docker-compose.yml tells operators
 * to put in front.
 *
 * The index is clamped at the front so a SHORT list cannot walk the selection
 * back onto a caller-supplied entry.
 *
 * `unknown` is a real answer, not a failure: with no forwarding header at all
 * every caller shares one bucket. That is a misconfiguration to fix at the
 * proxy — the alternative, skipping the limit when the client is
 * unidentifiable, turns a missing header into a way to opt out of it.
 */
export function clientIp(request: Request, hops: number = TRUSTED_PROXY_HOPS): string {
  return forwardedFor(request.headers, hops) || 'unknown';
}

/**
 * Two ways to present the same capability: an AGENT sends the token as a
 * bearer header; a BROWSER sends the httpOnly cookie that names it
 * (lib/agent-session). Both resolve to one live token row, so a route written
 * for agents serves the app's own editor unchanged — which is what lets the
 * browser hold no secret at all.
 *
 * Bearer wins when both are present: it is the explicit credential for THIS
 * call, while a cookie merely rides along.
 *
 * The Origin check applies to COOKIE-authorized mutations only. A browser
 * always sends Origin/Sec-Fetch-Site (the browser sets them; page script
 * cannot forge them), so a cross-site POST riding the cookie is CSRF and is
 * refused. A bearer call sends no Origin at all — an agent curling the API
 * must never be blocked by a header it has no reason to send.
 */
export function withTokenAuth(handler: TokenHandler) {
  return async (
    request: Request,
    routeCtx?: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    const auth = request.headers.get('authorization') ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    const resolved = presented ? await resolveToken(presented) : null;
    let actor: { id: string; userId: string | null; clientHarness: Harness | null } | null = resolved;
    let credential: Credential = 'bearer';
    if (!actor) {
      const browser = await sessionActor(request);
      if (browser.tokenId) actor = { id: browser.tokenId, userId: browser.viewer?.userId ?? null, clientHarness: null };
      credential = browser.credential;
      // A cookie authorizes a mutation only from our own site.
      if (actor && refusesCrossSite(request, browser)) return json({ error: 'forbidden' }, 403);
    }
    if (!actor) return unauthorized(request);
    if (resolved) {
      await touchToken(resolved.id);
      const declared = identifyClient({ agentHeader: request.headers.get(ARTIFACTBIN_AGENT_HEADER) });
      if (declared.source === 'agent-header') {
        await rememberTokenClient(resolved.id, declared.harness);
        // Make the declaration effective on this call as well as later stateless calls.
        actor = { ...resolved, clientHarness: declared.harness };
      }
    }
    const params = routeCtx ? await routeCtx.params : {};
    return handler(request, { tokenId: actor.id, userId: actor.userId, credential, clientHarness: actor.clientHarness, params });
  };
}

/** Does this request intend to CHANGE something? (GET/HEAD/OPTIONS do not.) */
export const isMutation = (request: Request): boolean =>
  !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());

/**
 * The browser-credential guard for session routes (/api/my/*): an account
 * session or the agent-session cookie, plus the same cross-site refusal.
 * Returns the actor, or the Response to answer with.
 */
export async function browserActor(request: Request): Promise<RequestActor | Response> {
  const actor = await sessionActor(request);
  if (!actor.viewer && !actor.tokenId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  return actor;
}

/**
 * THE same-site rule, keyed on HOW the caller authenticated: a cookie-borne
 * mutation from a cross-site Origin is refused; a bearer (agents send no
 * Origin) and the credential-less served document (opaque origin) never are.
 */
export function refusesCrossSite(request: Request, actor: Pick<RequestActor, 'credential'>): boolean {
  return isCookieCredential(actor) && isMutation(request) && isCrossSiteRequest(request);
}
