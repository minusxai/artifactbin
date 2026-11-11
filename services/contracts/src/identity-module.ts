/**
 * THE IDENTITY MODULE'S CONTRACT: every write to who someone is and who belongs where. The module is the auth
 * package (`@artifactbin/auth` createIdentityStore); it is the ONLY writer of `IDENTITY_OWNED_TABLES`, which every
 * other part of the installation (the app's joins and access checks, MinusX through the `identity` views) only
 * reads. One contract, two transports with one behaviour:
 *  - LOCAL: the store itself, in process, on the app's own database (a single-process install and the tests);
 *  - HTTP: `IDENTITY_CALL_PATH` on the auth host's `sessionAuthority` part (service-authenticated like
 *    `HUMAN_SESSION_LIVE_PATH`), reached through utils `identityClient` when the app has `AUTH__SERVICE_URL`.
 * The app picks one through its services registry (lib/platform `services().identity`).
 *
 * Every method is its own transaction, committed before it answers: a caller never passes, or holds, a transaction
 * of its own across a call (on PGLite that would wait on itself). What the app does about a change (its audit, its
 * events and notifications, waking live readers) it does AFTER the call, from the `GroupChange`s the call returns;
 * nothing of the app runs inside an identity transaction, and no app table is written by this module.
 *
 * A refusal is an `IdentityError` (code, HTTP status, optional retry-after seconds and detail), the same object on both
 * transports; anything else is a failure of the module itself.
 */
import type {GroupInvitation,GroupRole,GroupSummary} from './groups';
import type {Queryable} from './db';
import type {UserKind} from './testusers';

/** The tables only the identity module writes (scripts/ci/table-ownership.mjs, the generated grants.sql). */
export const IDENTITY_OWNED_TABLES = ['users', 'tokens', 'handle_reservations', 'groups', 'group_members', 'group_invitations', 'group_hierarchy', 'group_mail_outbox'] as const;

/** The HTTP transport: POST `{method, input}`, answered `{result}` or `{error, status, retry_after?}`. */
export const IDENTITY_CALL_PATH = '/api/internal/identity/call';

/** What the module needs of a database: queries, and a transaction whose callback gets its own connection. */
export interface TransactionalQueryable extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** `detail`: what the refusal concerns, when the caller needs it (`duplicate_email`: the id holding the address). */
export class IdentityError extends Error {
  constructor(public code: string, public status = 400, public retryAfter?: number, public detail?: string) { super(code); }
}

/**
 * One change to a group the module committed: the app records it in its audit (`group_audit`), announces it
 * (`changed` on the group, which projects member notifications) and wakes the live readers of what the group's
 * audience can see. `recipients` are the accounts the change concerns; `invitation_id`, when present in
 * `details`, names the invitation it made.
 */
export interface GroupChange {
  id: string;
  groupId: string;
  actorId: string;
  action: string;
  details: Record<string, unknown>;
  recipients: string[];
}

/** An account row as the module answers it (the columns the app's `UserRow` reads). */
export interface IdentityUserRow {
  id: string;
  email: string | null;
  kind: UserKind;
  parent_user_id: string | null;
  expires_at: string | null;
  name: string | null;
  username: string | null;
  image_key: string | null;
  welcome_pending: boolean;
  created_at: string;
}

export interface MintedIdentityToken {
  id: string;
  name: string | null;
  /** The plaintext, returned once and never stored. */
  token: string;
  expiresAt: string | null;
}

/** One claimed group mail: the row, and the claim that fences every later transition of it. */
export interface GroupMailClaim {
  id: string; email: string; recipient_id: string | null; group_id: string; group_name: string; handle: string;
  action: string; sender_id: string; attempts: number; claim_token: string;
}

export interface IdentityService {
  // ── accounts ──────────────────────────────────────────────────────────────
  /** The account row follows the actor's claims: created on first sight (welcome pending), email kept current, a
   * handle assigned. `duplicate_email` (409) when the address already belongs to another id. */
  syncProfile(input: {userId: string; email: string; testAccount: boolean}): Promise<{user: IdentityUserRow | null}>;
  createUser(input: {email: string; name?: string | null}): Promise<IdentityUserRow>;
  /** Assign a handle to an account row that has none; the row as it stands after. */
  ensureUsername(input: {userId: string}): Promise<IdentityUserRow | null>;
  setUsername(input: {userId: string; username: string}): Promise<{ok: true; username: string} | {error: 'invalid' | 'taken'}>;
  /** Point the picture at `key` (null: none); the key it replaced, for the caller to delete. */
  setImageKey(input: {userId: string; key: string | null}): Promise<{previous: string | null}>;
  confirmWelcome(input: {userId: string}): Promise<void>;
  setAutoAcceptMentions(input: {userId: string; autoAccept: boolean}): Promise<void>;
  /** A test user and its token, counted against `limit` live ones in the same transaction; null at the limit. */
  createTestUser(input: {parentId: string; label: string; ttlMs: number; limit: number; tokenName: string}): Promise<{id: string; created_at: string; expires_at: string; tokenId: string; token: string} | null>;
  /** Erase a test user's identity rows (its account row, its tokens, its handle); false when it was not one. */
  eraseTestUser(input: {userId: string}): Promise<boolean>;

  // ── tokens ────────────────────────────────────────────────────────────────
  /** `expiresInMs` null is non-expiring; out of range is `invalid_expiry` (400). */
  mintToken(input: {name?: string | null; userId?: string | null; expiresInMs: number | null; audience?: string | null; scope?: string | null; requestAuthority?: boolean}): Promise<MintedIdentityToken>;
  /** The account's 'web' token, minted once: its id and whether this call minted it. */
  ensureWebToken(input: {userId: string}): Promise<{id: string; minted: boolean}>;
  /** Soft revoke a live token (only the owner's, with `userId`); its name, or null when nothing live matched. */
  revokeToken(input: {id: string; userId?: string}): Promise<{name: string | null} | null>;
  /** Stamp last use, at most once a minute. */
  touchToken(input: {id: string}): Promise<void>;
  setTokenHarness(input: {id: string; harness: string}): Promise<void>;
  /** Grant request authority to the server-minted tokens whose name starts with `prefix`. */
  markRequestAuthority(input: {prefix: string}): Promise<void>;

  // ── groups (each answers the changes it committed) ────────────────────────
  createGroup(input: {actorId: string; handle: string; name: string; description?: string; parentId?: string | null}): Promise<{group: GroupSummary; hierarchyRevision: number; changes: GroupChange[]}>;
  updateGroup(input: {actorId: string; groupId: string; name?: string; description?: string}): Promise<{group: GroupSummary; changes: GroupChange[]}>;
  setGroupParent(input: {actorId: string; groupId: string; parentId: string | null; fromParentId?: string | null}): Promise<{changed: boolean; parent_id: string | null; previous_parent_id: string | null; hierarchy_revision?: number; changes: GroupChange[]}>;
  /** Soft delete (`deleted_at`): refused while live subgroups remain (`group_has_children`). */
  deleteGroup(input: {actorId: string; groupId: string; handle: string}): Promise<{changes: GroupChange[]}>;
  setGroupMember(input: {actorId: string; groupId: string; userId: string; role: GroupRole}): Promise<{changes: GroupChange[]}>;
  removeGroupMember(input: {actorId: string; groupId: string; userId: string}): Promise<{changes: GroupChange[]}>;
  inviteGroupMember(input: {actorId: string; groupId: string; email: string; role: GroupRole}): Promise<{invitation: GroupInvitation; changes: GroupChange[]}>;
  removeGroupInvitation(input: {actorId: string; groupId: string; invitationId: string}): Promise<{changes: GroupChange[]}>;
  /** Every pending invitation to this verified address joins the account (exactly once each). */
  acceptGroupInvitations(input: {userId: string; email: string}): Promise<{groupIds: string[]; changes: GroupChange[]}>;
  /** A company deployment's admission into its default group: the invitation's role (or viewer), consuming it. */
  admitToGroup(input: {userId: string; email: string; groupId: string; inviteOnly: boolean}): Promise<{admitted: boolean; changes: GroupChange[]}>;

  // ── the group mail outbox (the changes above write their own rows) ────────
  /** Mail for a change the APP made to what a group sees (a page shared with it): rows keyed by the change id, so a repeat is a no-op. */
  enqueueGroupMail(input: {change: GroupChange}): Promise<void>;
  /** Claim the next due mail for one lease, or null. */
  claimGroupMail(input: {leaseSeconds: number; maxAttempts: number}): Promise<GroupMailClaim | null>;
  /** A claimed mail's next step, fenced by its claim: pin the resolved recipient, mark it sent, or release it. */
  settleGroupMail(input: {id: string; claimToken: string; outcome: 'pin' | 'sent' | 'failed'; recipientId?: string; maxAttempts: number}): Promise<{owned: boolean}>;
}

export type IdentityMethod = keyof IdentityService;
export const IDENTITY_METHODS: readonly IdentityMethod[] = [
  'syncProfile', 'createUser', 'ensureUsername', 'setUsername', 'setImageKey', 'confirmWelcome', 'setAutoAcceptMentions', 'createTestUser', 'eraseTestUser',
  'mintToken', 'ensureWebToken', 'revokeToken', 'touchToken', 'setTokenHarness', 'markRequestAuthority',
  'createGroup', 'updateGroup', 'setGroupParent', 'deleteGroup', 'setGroupMember', 'removeGroupMember', 'inviteGroupMember', 'removeGroupInvitation', 'acceptGroupInvitations', 'admitToGroup',
  'enqueueGroupMail', 'claimGroupMail', 'settleGroupMail',
];
