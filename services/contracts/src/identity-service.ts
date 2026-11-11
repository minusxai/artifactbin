/**
 * WHAT ANY READER LEARNS ABOUT WHO SOMEONE IS (cross-repository contract §2), in two parts:
 *
 *  - IDENTITY FACTS as SHARED READS: one thin view per identity table in the read schema (`IDENTITY_SCHEMA` by
 *    default, IDENTITY__SCHEMA), named as the table: the table as it is minus its secret columns, plus the rule columns
 *    (`users.active`, `tokens.scopes` and `tokens.live`, `sessions.live`). No filtering: a reader keeps
 *    `deleted_at IS NULL` itself. Every reader (this app, and any service granted the views) reads these and only
 *    these (the app's search_path resolves `users` to the view); in a split-role database each reader role holds USAGE
 *    on the schema and SELECT on its views, and nothing on the identity module's base tables (@artifactbin/auth
 *    identity-store).
 *  - PRESENTING A BEARER (`IDENTITY_INTROSPECT_PATH`): verifying a raw token needs its hash or the identity module's
 *    key, which no view exposes, so it stays a service-authenticated call (SERVICE_AUTH_HEADER) to the auth host. With
 *    INTERNAL__SERVICE_SECRET the answer covers every token; with a service's own introspection secret
 *    (./service-audiences) it covers only tokens bound to that service's audience, every other token answering
 *    `{active: false}`. JSON in and out, read from committed state at request time.
 */
export const IDENTITY_INTROSPECT_PATH = '/api/internal/identity/introspect';

/**
 * The introspection answer. `audience`: the origin the token is bound to (null: a general-purpose token of this
 * installation, which no other service may accept). `expires_at`: ISO time, null when it does not expire. `actor`: set
 * only on a viewer token (./service-audiences): a first-party service (`id`) acting for `user_id`, and the page and
 * function that asked; `token_id` is then the token's own id, never a row of `tokens`.
 */
export type IdentityIntrospectResponse =
  | { active: true; user_id: string; token_id: string; scopes: string[]; audience: string | null; expires_at: string | null; actor: IntrospectedActor | null }
  | { active: false };
interface IntrospectedActor { id: string; artifact_id: string | null; function: string | null }

/** The default read schema (IDENTITY__SCHEMA): where the identity views live. */
export const IDENTITY_SCHEMA = 'identity';

/**
 * Every identity view and its columns, in order: the cross-repository read contract (generated from the identity
 * module's table declarations minus its secret columns, @artifactbin/auth identity-store/views, which a test pins to
 * this literal). A column added at the end of a table is added at the end of its view; anything else is a contract
 * change on both sides.
 *  - users: every account row; `active` is "may sign in and act on this deployment" (Artifactbin's one rule).
 *  - tokens: access tokens, never their hash; `scopes` is the granted scope list; `live` is the bearer read's rule (row,
 *    expiry, OAuth family fence), an audience of this deployment's API or of a configured service
 *    (IDENTITY__SERVICE_AUDIENCES), and an active account. A reader accepting a token checks its `audience` itself.
 *  - groups (`parent_id` null at a root; `deleted_at` set once deleted), group_members (DIRECT rows only),
 *    group_hierarchy (one row, id 'installation': the revision moves on every group create, delete and reparent),
 *    group_invitations, handle_reservations, group_mail_outbox: the tables as they are.
 *  - sessions: Better Auth's browser sessions, never their token; `live` while unexpired.
 */
export const IDENTITY_VIEWS = {
  users: ['id', 'email', 'kind', 'parent_user_id', 'expires_at', 'merged_into_user_id', 'name', 'username', 'image_key', 'auto_accept_mentions', 'welcome_pending', 'test_account', 'created_at', 'active'],
  tokens: ['id', 'name', 'user_id', 'client_harness', 'audience', 'scope', 'request_authority', 'created_at', 'deleted_at', 'expires_at', 'last_used_at', 'scopes', 'live'],
  handle_reservations: ['handle', 'kind', 'subject_id'],
  groups: ['id', 'handle', 'name', 'description', 'created_by', 'created_at', 'deleted_at', 'parent_id'],
  group_hierarchy: ['id', 'revision'],
  group_members: ['group_id', 'user_id', 'role', 'created_at'],
  group_invitations: ['id', 'group_id', 'email', 'role', 'invited_by', 'created_at'],
  group_mail_outbox: ['id', 'email', 'recipient_id', 'group_id', 'group_name', 'handle', 'action', 'sender_id', 'lease_until', 'claim_token', 'attempts', 'next_attempt_at', 'quarantined_at', 'sent_at', 'created_at'],
  sessions: ['id', 'expiresAt', 'createdAt', 'updatedAt', 'ipAddress', 'userAgent', 'userId', 'live'],
} as const;
