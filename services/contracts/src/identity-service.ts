/**
 * WHAT MINUSX LEARNS FROM ARTIFACTBIN ABOUT WHO SOMEONE IS (cross-repository contract §2), in two parts:
 *
 *  - IDENTITY FACTS as SHARED READS: the views of schema `identity` in the one database both products use
 *    (`IDENTITY_VIEWS`, created by the app: lib/groups identity-views, rendered to IDENTITY.sql). Groups, direct
 *    memberships, the hierarchy revision, whether an account is active, and whether a browser session or an agent
 *    token is still live, by id. No column carries a secret, a hash of one or an email address; MinusX's database
 *    role holds USAGE on the schema and SELECT on these views, and nothing on the tables behind them.
 *  - PRESENTING A BEARER (`IDENTITY_INTROSPECT_PATH`): verifying a raw Artifactbin access token needs its hash, which
 *    no view exposes, so it stays a service-authenticated call (SERVICE_AUTH_HEADER carrying INTERNAL__SERVICE_SECRET)
 *    to the auth host's bearer read. JSON in and out, read from committed state at request time.
 */
export const IDENTITY_INTROSPECT_PATH = '/api/internal/identity/introspect';

export type IdentityIntrospectResponse = { active: true; user_id: string; token_id: string; scopes: string[] } | { active: false };

/** The schema the shared identity views live in. */
export const IDENTITY_SCHEMA = 'identity';

/**
 * Every shared identity view and its columns, in order: the cross-repository contract MinusX reads. Adding a column
 * at the end is compatible; anything else is a contract change on both sides.
 *  - groups: live groups only (a deleted group has no row); `parent_id` null at a root.
 *  - memberships: DIRECT membership rows of live groups. Membership of a descendant or an ancestor is not one.
 *  - hierarchy: one row, the installation-wide revision; it increases on every group create, delete and reparent.
 *  - users: every account row; `active` is "may sign in and act on this deployment" (Artifactbin's one rule).
 *  - sessions: browser sessions; `live` while unexpired.
 *  - tokens: access tokens; `live` by the bearer read's own rule (row, expiry, OAuth family fence, this deployment's
 *    API audiences, an active account). `scopes` is the granted scope list.
 */
export const IDENTITY_VIEWS = {
  groups: ['id', 'handle', 'name', 'parent_id'],
  memberships: ['group_id', 'user_id'],
  hierarchy: ['revision'],
  users: ['id', 'active'],
  sessions: ['id', 'user_id', 'live'],
  tokens: ['id', 'user_id', 'scopes', 'live'],
} as const;
