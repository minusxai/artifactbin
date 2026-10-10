/**
 * THE ACTOR TYPES: who is asking, as identity knows it. Resource policy (lib/artifacts access,
 * grants, membership) reads these; nothing here decides what an actor may do.
 */

/** Authenticated account claims supplied by the identity bridge, never request JSON. */
export interface VerifiedAccount {
  userId: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

/** Who is looking, as far as the serving paths know. Null = no session. */
export type Viewer = (VerifiedAccount & { userId: string; email: string | null }) | null;

/** Any credential the serving paths resolve, as the ids and address effectiveRole needs. */
export interface RoleActor extends VerifiedAccount {
  /** Saved owner context supplied by server code only. */
  groupId?:string|null;
  userId: string | null;
  tokenId: string | null;
  /**
   * The address the session carries, when it carries one. Only ever consulted
   * for a share that is still UNRESOLVED — the moment one matches it is stamped
   * with the user id and matched by that forever after. Email is an attribute,
   * never an identity key.
   */
  email?: string | null;
}

// ── The bearer actor ─────────────────────────────────────────────────────────
//
// A presented token acts in ONE of the two artifact scopes (lib/artifacts access: ownerScope,
// editorScope). A token claimed by an
// account acts ACCOUNT-WIDE: any of a user's tokens may read, edit, and manage
// anything the user owns, because handing an agent a token IS handing it the
// account's documents — a second agent must be able to pick up a document the
// first one created. (Render-time ref resolution already widened this way; see
// refDataForRow.) An anonymous token reaches only what it itself created —
// there is no account to widen to, so the token-scope boundary stands.
//
// Safe because creation stamps user_id from the token and claiming backfills
// it: a user-owned token cannot have artifacts its user scope would miss.

export interface TokenActor extends VerifiedAccount {
  /** Server-only saved artifact owner for author reference resolution. Never request input. */
  groupId?: string | null;
  tokenId: string;
  userId: string | null;
}
