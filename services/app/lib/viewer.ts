/**
 * The auth() → Viewer bridge, in its own module ON PURPOSE: the serving
 * routes need "who is looking" but lib/artifacts must stay importable
 * without dragging NextAuth into every test and client bundle that touches
 * artifact SQL. This is the only non-route file that imports @/auth.
 */
import { currentRequest } from './request-context';
import { actorOf } from '@artifactbin/utils';
import type { Credential } from '@artifactbin/contracts';
import { syncProfile } from './profiles';
import { effectiveRole as artifactRole, ownsArtifact, type ArtifactRole, type ArtifactRow, type RoleActor, type TokenActor, type Viewer } from './artifacts';
import { AGENT_COOKIE, decodeAgentSession } from './agent-session';
import { parseCookie } from './http';
import { resolveToken, resolveTokenById, touchToken } from './tokens';

/**
 * The account behind the request, if any. Behind the proxy that is the signed
 * actor header; without one (a direct handler call in a test) it is whatever
 * the test mocked `@/auth` to say. Fail-safe: never a crash.
 */
export async function sessionViewer(request?: Request): Promise<Viewer> {
  try {
    const fromProxy = await proxyActor(request);
    if (fromProxy) return fromProxy.credential === 'session' ? fromProxy.viewer : null;
    const { auth } = await import('@/auth');
    const session = await auth();
    return session?.user?.id ? { userId: session.user.id, email: session.user.email ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Who is asking. A presented bearer token wins (its user, if claimed, becomes
 * the viewer; its id lets the caller honor direct token ownership), else the
 * browser's credentials — see requestOrSessionActor (the export route's
 * resolver); routes that hand-roll a bearer check fall back to sessionActor.
 */
export interface RequestActor {
  viewer: Viewer;
  /** The presented token's id, for token-scope ownership checks. Null without a valid bearer. */
  tokenId: string | null;
  /**
   * HOW the caller was authenticated (`services/contracts` Credential). Load-
   * bearing for the same-site guard: a cookie-borne write must be same-site,
   * a bearer one never is (agents send no Origin). Keying that guard on
   * `tokenId` protected the anonymous browser and waved the logged-in one
   * through — `session` yields tokenId null — which is the hole this closes.
   */
  credential: Credential;
  /** Token ids the browser's agent cookie holds (proxy-provided) — what a sign-up may claim. */
  heldTokenIds?: string[];
}

export const NO_ACTOR: RequestActor = { viewer: null, tokenId: null, credential: 'none' };

/** A cookie authorized this request — the only case a same-site guard applies to. */
export const isCookieCredential = (actor: Pick<RequestActor, 'credential'>): boolean =>
  actor.credential === 'session' || actor.credential === 'agent-cookie';

/**
 * The proxy's verdict rides ON the Request the proxy handed us
 * (`attachActor` uses a WeakMap, so there is no forgeable header to inspect).
 */
function attachedActor(request: Request | undefined): RequestActor | null {
  const carrying = request ?? currentRequest();
  const actor = carrying ? actorOf(carrying) : null;
  if (!actor) return null;
  return {
    viewer: actor.userId ? { userId: actor.userId, email: actor.email ?? null } : null,
    tokenId: actor.tokenId ?? null,
    credential: actor.credential,
    ...(actor.heldTokenIds ? { heldTokenIds: actor.heldTokenIds } : {}),
  };
}

/**
 * The proxy's verdict, when there is a proxy. No attached actor means direct
 * mode, where the app resolves its own bearer/session/agent-cookie credential.
 */
async function proxyActor(request: Request | undefined): Promise<RequestActor | null> {
  const attached = attachedActor(request);
  if (attached) {
    // The app's own row for this person follows the claims (lib/profiles) — created on first sight, updated on change.
    if (attached.credential === 'session' && attached.viewer?.userId) await syncProfile({ userId: attached.viewer.userId, email: attached.viewer.email ?? undefined });
    return attached;
  }
  return null;
}


/**
 * Who is asking, for a request that carries BROWSER credentials.
 *
 * Two envelopes, one answer. A NextAuth session is an ACCOUNT (userId, and
 * account-wide reach). The agent-session cookie is a browser holding token ids
 * — an anonymous owner, whose reach is exactly what its token created. An
 * account wins when both are present: it is the wider, named identity, and it
 * is what the user sees themselves as while signed in.
 *
 * The token is re-resolved here on EVERY request (resolveTokenById keeps the
 * revoked check), so revoking a token ends the browser's session on the next
 * call rather than at cookie expiry.
 *
 * This is the ONE ownership seam: the page (ArtifactDocument), the API routes
 * and the reader/owner proxy all ask it, so they cannot drift apart on who
 * owns a document.
 */
export async function sessionActor(request?: Request, opts: { headerOnly?: boolean } = {}): Promise<RequestActor> {
  const fromProxy = await proxyActor(request);
  if (fromProxy) {
    if (fromProxy.tokenId && (fromProxy.credential === 'bearer' || fromProxy.credential === 'agent-cookie')) {
      await touchToken(fromProxy.tokenId);
    }
    return fromProxy;
  }
  if (opts.headerOnly) return NO_ACTOR;
  const viewer = await sessionViewer(request);
  if (viewer) return { viewer, tokenId: null, credential: 'session' };

  // Fail CLOSED, like sessionViewer above: `cookies()` throws synchronously
  // outside a request scope (direct handler calls in tests, build-time
  // rendering), and a credential lookup that cannot run is no credential —
  // never a crash.
  // The request in hand, or the one the server is holding for this call
  // (lib/request-context). Off-request there is no cookie and no credential.
  const carrying = request ?? currentRequest();
  const raw = carrying ? parseCookie(carrying.headers.get('cookie'), AGENT_COOKIE) : undefined;
  const session = await decodeAgentSession(raw);
  if (!session) return NO_ACTOR;

  // The LAST id is the primary — the token a write acts as. Earlier ids are
  // still held (they are what a sign-up may claim), but they do not authorize.
  const primary = session.tokenIds[session.tokenIds.length - 1];
  const token = await resolveTokenById(primary);
  if (!token) return NO_ACTOR;
  await touchToken(token.id);
  return { viewer: token.userId ? { userId: token.userId, email: null } : null, tokenId: token.id, credential: 'agent-cookie' };
}

/** A request-scoped actor, bearer first (agents), then browser credentials. */
export async function requestOrSessionActor(request: Request): Promise<RequestActor> {
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const token = offered ? await resolveToken(offered) : null;
  if (token) {
    await touchToken(token.id);
    return { viewer: token.userId ? { userId: token.userId, email: null } : null, tokenId: token.id, credential: 'bearer' };
  }
  return sessionActor(request);
}

/**
 * The actor as an artifact-SQL scope, or null when the request carries no
 * credential at all. `TokenActor` needs a tokenId, so an account session
 * borrows its own id slot: `actorScope` reads `userId` first and only falls
 * back to the token, so the empty string is never consulted for a user.
 */
export function actorForArtifacts(actor: RequestActor): TokenActor | null {
  if (actor.viewer?.userId) return { tokenId: actor.tokenId ?? '', userId: actor.viewer.userId };
  return actor.tokenId ? { tokenId: actor.tokenId, userId: null } : null;
}

/** A request's credentials as the ids and address the role decision reads. */
const roleActor = (actor: RequestActor): RoleActor => ({ userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId, email: actor.viewer?.email ?? null });

/** Does this actor OWN the row — pure (lib/artifacts ownsArtifact), for the places that need only that. */
export function isOwner(row: Pick<ArtifactRow, 'user_id' | 'token_id'>, actor: RequestActor): boolean {
  return ownsArtifact(row, roleActor(actor));
}

/**
 * This actor's ROLE on the row — the one definition, used by page and app
 * server alike: the MAX of ownership, the share list and what the link grants
 * (lib/artifacts effectiveRole). Both halves of the reader/owner split ask
 * this, so they cannot disagree on who gets the shell; `none` is the miss that
 * every serving path answers as the uniform 404.
 */
export function roleFor(row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'visibility' | 'link_role'>, actor: RequestActor): Promise<ArtifactRole> {
  return artifactRole(row, roleActor(actor));
}

/**
 * How a browser is authenticated, for the top bar's session control. Three
 * outcomes, because there are three ways to hold (or not hold) a credential:
 *
 *  - 'account' — a NextAuth session. Offers "Sign out".
 *  - 'anon'    — no account, but the agent-session cookie resolves to a live
 *                token (lib/agent-session). Offers "Disconnect this browser".
 *  - 'none'    — neither. Offers "Log in".
 *
 * A CLAIMED token held only in the cookie is 'anon', not 'account': there is
 * no NextAuth session to sign out of, and the thing to clear is the cookie.
 * Fails to 'none' if resolution throws off-request (same as sessionActor).
 */
export async function browserSessionKind(request?: Request): Promise<'account' | 'anon' | 'none'> {
  if (await sessionViewer()) return 'account';
  const actor = await sessionActor(request);
  return actor.tokenId ? 'anon' : 'none';
}
