/**
 * ONE REQUEST, ONE IDENTITY. Every credential a request can carry is resolved HERE, into one
 * `RequestIdentity`, and every door (`withTokenAuth`, `requestOrSessionActor`, `sessionActor`,
 * `browserActor`, `auth()`) is a thin policy over it: which credentials it admits, how it treats a
 * dry run, and what it answers with. Handlers receive the identity whole and pass it on unchanged.
 *
 * The credentials, in the order they are tried:
 *
 *  - an EXPLICIT BEARER (`Authorization`, token and request doors): the app resolves the token itself. A
 *    bearer that does not resolve is a refusal, never a fall back to a cookie identity. Proxy claims
 *    (address, verified flag) are attached only when they name this very token and account.
 *  - the PROXY-ATTACHED actor (`attachActor`, a WeakMap no header can forge): an account session, a bearer
 *    the proxy resolved, a pages-host agent cookie or a pages session, the browser-session transport, and
 *    the app's own internal re-entries (runner, hosted comments).
 *  - DIRECT MODE (no proxy): the account session `auth()` names (the test seam `overrideSession`).
 *
 * The host's document-editor policy is evaluated here, ONCE, from verified claims only (a session or a
 * bearer, never under the browser-session header, never for an agent cookie or a direct session), and
 * recorded as `documentEditor`; nothing downstream sees a claim.
 *
 * MEMOISED per request (`answeredOnce`, lib/accounts tokens), so the side effects — token touch, profile
 * sync, invitations, guest merge, admission, hosted refusal — run once however many times a request asks.
 * Only while the request is the current one (the server runs every handler inside `runWithRequest`), and
 * forgotten with the request's other credential answers whenever it writes a token row. A route that
 * re-checks access mid-run (a long query) asks with `revalidate`: no memo, no side effects.
 */
import { BROWSER_SESSION_HEADER, type Credential } from '@artifactbin/contracts';
import { actorOf } from '@artifactbin/utils';
import { admitDeploymentIdentity } from '../deployment';
import { acceptGroupInvitations } from '../groups';
import { pagesRequestOf } from '../http';
import { identifyClient, ARTIFACTBIN_AGENT_HEADER, type Harness } from '../accounts';
import { currentRequest } from '../platform';
import { DuplicateProfileEmail, NO_IDENTITY, answeredOnce, rememberTokenClient, resolveToken, resolveTokenById, syncProfile, touchToken, type RequestIdentity } from '@/lib/accounts';
import { canAuthenticateUser } from '../user-kinds';
import { hasDocumentEditorAccess } from './document-editor';
import { mergeGuestUsers } from './ownership';
import { hostedRequestRefusal } from './request-authority';
import { auth } from './session';

/**
 * The door asking. `token`: `withTokenAuth`, a token required, dry runs leave no trace. `request`: an
 * explicit bearer first, then the browser's credentials, dry runs deliberately ignored (see
 * `requestOrSessionActor`). `session`: the browser's credentials only (a bearer reaches it as the proxy's
 * attached actor).
 */
export type Door = 'token' | 'request' | 'session';

export interface ResolveOptions {
  /** Token door: an explicit `X-Artifactbin-Dry-Run` GET/HEAD — no touch, no client memory, no profile write. */
  dryRun?: boolean;
  /** Token door: a read-only route — no touch, no client memory (the profile row is still written). */
  readOnly?: boolean;
  /** Session door: the proxy's attached actor only, never direct mode (`auth()`). */
  headerOnly?: boolean;
  /** A mid-request access re-check: bypass the memo and run no side effects. */
  revalidate?: boolean;
}

export type IdentityResolution =
  | { kind: 'identity'; identity: RequestIdentity; clientHarness: Harness | null }
  /** An explicit bearer that names no live token: the token door's uniform 401. */
  | { kind: 'bearer-invalid' }
  /** The hosted request authority refused (or deferred) an explicit bearer on the token door. */
  | { kind: 'refused'; response: Response };

const nobody = (): IdentityResolution => ({ kind: 'identity', identity: NO_IDENTITY, clientHarness: null });

export function resolveRequestIdentity(request: Request | undefined, door: Door, options: ResolveOptions = {}): Promise<IdentityResolution> {
  const carrying = request ?? currentRequest() ?? undefined;
  const effects = !options.revalidate;
  if (door !== 'session' && carrying) {
    const presented = explicitBearer(carrying);
    if (presented !== null) {
      const variant = door === 'token' ? `token:${options.dryRun ? 'd' : ''}${options.readOnly ? 'r' : ''}` : 'request';
      return remembered(carrying, `bearer:${variant}`, effects, () => bearerIdentity(carrying, presented, door, { ...options, effects }));
    }
  }
  return sessionIdentity(carrying, options.headerOnly === true, effects);
}

/** The memo: the current request's, unless this is a re-check. */
function remembered(request: Request | undefined, key: string, effects: boolean, resolve: () => Promise<IdentityResolution>): Promise<IdentityResolution> {
  return effects && request && request === currentRequest() ? answeredOnce(`identity:${key}`, resolve) : resolve();
}

/** Any `Authorization` header is an explicit credential; its bearer token, or null without the header. */
function explicitBearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  return presented || null;
}

/** The one place a claim becomes an identity, and the host policy is asked. */
function identityOf(claims: { userId: string | null; tokenId: string | null; email: string | null; emailVerified: boolean | null }, credential: Credential, heldTokenIds?: string[]): RequestIdentity {
  const { userId, tokenId, email, emailVerified } = claims;
  const documentEditor = emailVerified !== null && hasDocumentEditorAccess({ userId, email, emailVerified });
  return { userId, tokenId, email, emailVerified, documentEditor, credential, ...(heldTokenIds ? { heldTokenIds } : {}) };
}

// ── The explicit bearer ──────────────────────────────────────────────────────

async function bearerIdentity(request: Request, presented: string, door: 'token' | 'request', options: ResolveOptions & { effects: boolean }): Promise<IdentityResolution> {
  // A trusted identity owner refusal must survive app-owned token resolution.
  const claims = actorOf(request);
  if(claims?.credential==='none')return door==='token'?{kind:'bearer-invalid'}:nobody();
  const token = await resolveToken(presented);
  if (!token) return door === 'token' ? { kind: 'bearer-invalid' } : nobody();
  // The proxy's claims belong to this credential only when they name this very token and account, and never
  // for a browser session's scripted browser (which holds a token, not a verified login).
  const matched = !request.headers.has(BROWSER_SESSION_HEADER) && claims?.credential === 'bearer' && !!token.userId
    && claims.userId === token.userId && claims.tokenId === token.id;
  // Scoped OAuth candidates are private until auth publishes their family membership.
  // A raw bearer on a direct app listener cannot bypass that owner's fence.
  if(token.audience&&!matched)return door==='token'?{kind:'bearer-invalid'}:nobody();
  const identity = identityOf({
    userId: token.userId,
    tokenId: token.id,
    email: matched ? claims.email ?? null : null,
    emailVerified: matched ? claims.emailVerified === true : null,
  }, 'bearer');
  const refused = await hostedRequestRefusal(token.userId, token.id, request, door === 'token' && request.headers.get(BROWSER_SESSION_HEADER) === '1');
  if (refused) return door === 'token' ? { kind: 'refused', response: refused } : nobody();
  let clientHarness = token.clientHarness;
  if (options.effects) {
    // The token door's convention: an explicit dry run is a QUESTION and leaves no trace; a read-only route
    // is an ordinary visit and still writes the profile row the share predicates read. The request door has
    // no dry-run notion at all (`requestOrSessionActor`).
    const dryRun = door === 'token' && options.dryRun === true;
    if (!dryRun) await syncBearerProfile(identity);
    if (door === 'request' || !(dryRun || options.readOnly)) {
      await touchToken(token.id);
      const declared = door === 'token' ? identifyClient({ agentHeader: request.headers.get(ARTIFACTBIN_AGENT_HEADER) }) : null;
      if (declared?.source === 'agent-header') {
        await rememberTokenClient(token.id, declared.harness);
        // Effective on this call as well as on later stateless ones.
        clientHarness = declared.harness;
      }
    }
  }
  return { kind: 'identity', identity, clientHarness };
}

/**
 * The app's own `users` row for a BEARER caller, from the proxy's claims.
 *
 * The row is what every SQL share predicate reads an invitation through: `artifact_shares` holds the invited
 * ADDRESS, and while the share is still unresolved `lib/artifacts` matches it as
 * `(SELECT email FROM users WHERE id = $actor)`. Written on the first COOKIE session alone, that subselect was
 * NULL for someone who had only ever used the CLI — so an invited account's listing was empty, a named
 * editor's pull was the uniform 404 and a commenter could not comment, until one browser visit created the
 * row. The claims ride on a bearer request too, so the row follows them at both bearer doors. Cheap on the
 * hot path: `syncProfile` keeps an LRU of what it has written.
 *
 * EXACTLY ONE failure is absorbed. A SECOND identity for one address is a provisioning fault the lazy upsert
 * cannot absorb (lib/profiles diagnoses it by name), PERMANENT until a human resolves it: rethrowing would turn
 * every one of that person's CLI calls into a 500 for a row they can live without. It is said once per user
 * id. ANYTHING ELSE PROPAGATES: the cookie door has always called `syncProfile` unguarded, and every route
 * that gets here goes on to query the same database, so a broken database fails the request either way.
 */
async function syncBearerProfile(identity: RequestIdentity): Promise<void> {
  if (!identity.userId || !identity.email) return;
  try {
    await syncProfile({ userId: identity.userId, email: identity.email });
    if (identity.emailVerified) await acceptGroupInvitations(identity.userId, identity.email);
  } catch (error) {
    if (!(error instanceof DuplicateProfileEmail)) throw error;
    warnDuplicateOnce(identity.userId, error.message);
  }
}

/** User ids already reported as duplicate-address faults: per person, process-lifetime, bounded. */
const WARNED_MAX = 5000;
const warnedDuplicateProfile = new Set<string>();
function warnDuplicateOnce(userId: string, message: string): void {
  if (warnedDuplicateProfile.has(userId)) return;
  warnedDuplicateProfile.add(userId);
  if (warnedDuplicateProfile.size > WARNED_MAX) warnedDuplicateProfile.delete(warnedDuplicateProfile.keys().next().value!);
  console.warn(message);
}

// ── The browser's credentials ────────────────────────────────────────────────

async function sessionIdentity(carrying: Request | undefined, headerOnly: boolean, effects: boolean): Promise<IdentityResolution> {
  if (carrying && actorOf(carrying)) return remembered(carrying, 'attached', effects, () => attachedIdentity(carrying, effects));
  if (headerOnly) return nobody();
  return remembered(carrying, 'direct', effects, directIdentity);
}

/** The proxy's verdict, re-admitted by the app: admission, the agent-cookie and browser-session token checks, hosted authority. */
async function attachedIdentity(request: Request, effects: boolean): Promise<IdentityResolution> {
  const wire = actorOf(request)!;
  const userId = wire.userId ?? null, tokenId = wire.tokenId ?? null, browserSession = request.headers.get(BROWSER_SESSION_HEADER) === '1';
  const verifiable = (wire.credential === 'session' || wire.credential === 'bearer') && !request.headers.has(BROWSER_SESSION_HEADER);
  const identity = identityOf({
    userId,
    tokenId,
    email: userId ? wire.email ?? null : null,
    emailVerified: userId && verifiable ? wire.emailVerified === true : null,
  }, wire.credential, wire.heldTokenIds);
  if(wire.credential==='session')identity.sessionId=wire.sessionId;
  if (userId && !await admitDeploymentIdentity({ userId, email: identity.email ?? undefined, ...(identity.emailVerified === null ? {} : { emailVerified: identity.emailVerified }) })) return nobody();
  if (wire.credential === 'agent-cookie') {
    // Only the pages host creates token-backed browser cookies. Its WeakMap mark cannot be supplied by a
    // client; the cookie CSRF guard still applies (`refusesCrossSite`).
    const token = tokenId ? await resolveTokenById(tokenId) : null;
    if (!pagesRequestOf(request) || !token || !userId || token.userId !== userId || !await canAuthenticateUser(token.userId)) return nobody();
  }
  if (wire.credential === 'bearer' && !await canAuthenticateUser(userId)) return nobody();
  if (browserSession) {
    // A browser session lives longer than any one token check: its token must still be live and the account's.
    const token = tokenId ? await resolveTokenById(tokenId) : null;
    if (!token || token.userId !== userId) return nobody();
  }
  if (effects && wire.credential === 'session' && userId) {
    // The app's own row for this person follows the claims (lib/profiles) — created on first sight, updated on change.
    await syncProfile({ userId, email: identity.email ?? undefined });
    if (identity.emailVerified && identity.email) await acceptGroupInvitations(userId, identity.email);
    // Held legacy ownership proofs are adopted only AFTER a verified email login; they never authenticate alone.
    if (identity.emailVerified) await mergeGuestUsers(userId, wire.heldTokenIds ?? []);
  }
  if (await hostedRequestRefusal(userId, tokenId, request, browserSession || wire.credential === 'agent-cookie')) return nobody();
  if (effects && tokenId && (wire.credential === 'bearer' || wire.credential === 'agent-cookie')) await touchToken(tokenId);
  return { kind: 'identity', identity, clientHarness: null };
}

/** Direct mode: the account session `auth()` names, admitted to this deployment. Fail-safe: never a crash. */
async function directIdentity(): Promise<IdentityResolution> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId || !await admitDeploymentIdentity({ userId, email: session.user.email ?? undefined })) return nobody();
    return { kind: 'identity', identity: identityOf({ userId, tokenId: null, email: session.user.email ?? null, emailVerified: null }, 'session'), clientHarness: null };
  } catch {
    return nobody();
  }
}

// ── The doors that answer with an identity ───────────────────────────────────

const identityOrNobody = (resolution: IdentityResolution): RequestIdentity => resolution.kind === 'identity' ? resolution.identity : NO_IDENTITY;

/**
 * THE SESSION DOOR: the browser's credentials (an account session, a pages session, the pages-host agent
 * cookie, a browser session's scripted browser) or a bearer the proxy resolved. `headerOnly` never consults
 * direct mode (`auth()` itself).
 */
export async function sessionActor(request?: Request, options: Pick<ResolveOptions, 'headerOnly' | 'revalidate'> = {}): Promise<RequestIdentity> {
  return identityOrNobody(await resolveRequestIdentity(request, 'session', options));
}

/**
 * THE REQUEST DOOR: an explicit bearer first (agents), then the browser's credentials. Export, mutate, tables,
 * raw, the dataset endpoints and the remote routes admit a token here rather than through `withTokenAuth`.
 *
 * The token door's dry-run suppression is deliberately NOT repeated here: the client that sets the header most
 * (preview-entry, which marks its whole session read-only) reaches exactly these routes, so honouring it here
 * would leave a bearer-only invitee rowless on the paths the profile sync exists for.
 */
export async function requestOrSessionActor(request: Request, options: Pick<ResolveOptions, 'revalidate'> = {}): Promise<RequestIdentity> {
  return identityOrNobody(await resolveRequestIdentity(request, 'request', options));
}

/** A cookie authorized this request — the only case a same-site guard applies to. */
export const isCookieCredential = (actor: Pick<RequestIdentity, 'credential'>): boolean =>
  actor.credential === 'session' || actor.credential === 'agent-cookie';

/**
 * A request a browser session's scripted browser made: the session transport (services/browser
 * `forwardSessionFetch`) marks it and attaches the actor the session browses as. The header alone is text
 * anyone may send; with no attached actor it is not a session's request.
 */
export function isBrowserSessionRequest(request: Request): boolean {
  return request.headers.get(BROWSER_SESSION_HEADER) === '1' && actorOf(request) !== null;
}

/** Browser controls reflect email sessions only; legacy ownership proofs are not login. */
export async function browserSessionKind(request?: Request, admitted?: RequestIdentity): Promise<'account' | 'none'> {
  const actor = admitted ?? await sessionActor(request);
  return actor.credential === 'session' && !!actor.userId ? 'account' : 'none';
}
