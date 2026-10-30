/**
 * THE ACTOR TYPES: who is asking, as identity knows it. Resource policy (lib/artifact-access,
 * grants, membership) reads `AccessActor`; nothing here decides what an actor may do.
 */
import type { Credential } from '@artifactbin/contracts';

/**
 * THE ACTOR every access decision reads: ownership, shares, the link, the SQL scopes, dataset grants and
 * notification authority. Every field is REQUIRED (null is a value, absence is a compile error), so a
 * literal that drops one does not compile: pass the resolved identity through instead of rebuilding it.
 *
 * Exactly two constructors: `resolveRequestIdentity` (lib/authentication request-identity) for a request, and
 * `identityForUser` below for a principal the server rebuilds from its own rows.
 */
export interface AccessActor {
  /** The account, or null for a bare token (or nobody). */
  userId: string | null;
  /** The presented token's id, for token-scope ownership. Null for an account session and for nobody. */
  tokenId: string | null;
  /**
   * The address this credential carries. Consulted ONLY to match a share that is still unresolved
   * (lib/artifact-access/access-facts `sessionEmail`) — the moment one matches it is stamped with the user id
   * and matched by that forever after. Email is an attribute, never an identity key.
   */
  email: string | null;
  /**
   * The host's document-editor grant (production: ADMIN__EMAILS), decided ONCE by the resolver from
   * verified claims. It reaches only page documents that are not private (lib/artifact-access).
   */
  documentEditor: boolean;
  /** Server-only saved artifact owner, for author reference resolution. Never request input. */
  groupId?: string | null;
}

/**
 * One request's resolved identity: the actor, plus how it proved itself. `credential` keys the same-site
 * guard (a cookie-borne write must be same-site; a bearer never is); `heldTokenIds` are the ids the
 * browser's agent cookie holds (proxy-provided), what a sign-up may claim; `emailVerified` is the
 * verified-email claim AS THIS DOOR ADMITTED IT (null when the credential carries none, or a browser
 * session's scripted browser), kept only so a pages ticket can carry the claim across origins — access
 * code reads `documentEditor`, never this.
 */
export interface RequestIdentity extends AccessActor {
  sessionId?:string;
  credential: Credential;
  emailVerified: boolean | null;
  heldTokenIds?: string[];
}

/**
 * The same actor, holding a token: what creating, the per-token quotas and web imports are charged to. Every
 * token-door identity is one (`withTokenAuth`), and an account session becomes one by minting its own token.
 */
export type TokenHoldingActor = AccessActor & { tokenId: string };

/** The account a write is scoped to: the user, else the bare token. Nobody owns nothing, so nobody is refused. */
export function accountOf(actor: Pick<AccessActor, 'userId' | 'tokenId'>): string {
  const account = actor.userId ?? actor.tokenId;
  if (!account) throw new Error('an actor with neither an account nor a token owns nothing');
  return account;
}

/** Nobody: no account, no token, no grant. */
export const ANONYMOUS_ACTOR: AccessActor = Object.freeze({ userId: null, tokenId: null, email: null, documentEditor: false });

/** Nobody, as a request's identity. */
export const NO_IDENTITY: RequestIdentity = Object.freeze({ ...ANONYMOUS_ACTOR, credential: 'none', emailVerified: null });

/**
 * A principal the server rebuilds from its own rows (a notification recipient, a runner's user, a document's
 * author, a membership target) rather than from a request. No verified claim exists there, so the host's
 * document-editor grant never applies.
 */
export function identityForUser(userId: string | null, tokenId: string, email?: string | null): TokenHoldingActor;
export function identityForUser(userId: string | null, tokenId?: string | null, email?: string | null): AccessActor;
export function identityForUser(userId: string | null, tokenId: string | null = null, email: string | null = null): AccessActor {
  return { userId, tokenId, email, documentEditor: false };
}
