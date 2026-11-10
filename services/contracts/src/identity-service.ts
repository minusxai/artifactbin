/**
 * THE IDENTITY ENDPOINTS (cross-repository contract §2): what MinusX asks Artifactbin about a user, a token and
 * their groups. Service-authenticated exactly like `HUMAN_SESSION_LIVE_PATH` (SERVICE_AUTH_HEADER carrying
 * INTERNAL__SERVICE_SECRET), JSON in and out, every answer read from committed state at request time.
 *
 * The auth host serves them in front of its internal boundary: it answers `introspect` from its own bearer read
 * and relays `resolve` and `groups` to the app, which owns groups and accounts.
 */
export const IDENTITY_PATHS = {
  resolve: '/api/internal/identity/resolve',
  introspect: '/api/internal/identity/introspect',
  groups: '/api/internal/identity/groups',
} as const;

/** `session_id` and `group_id` are optional. */
export interface IdentityResolveRequest { user_id: string; session_id?: string; group_id?: string }

export interface IdentityResolveResponse {
  /** The account exists and may sign in. */
  active: boolean;
  /** null when no `session_id` was sent. */
  session_live: boolean | null;
  /** null when no `group_id` was sent or the group does not exist (or is deleted). */
  group: {
    id: string;
    /** A DIRECT membership row in exactly this group; a descendant's or an ancestor's is not membership. */
    member: boolean;
    /** The group, then its parent, up to the root. */
    chain: string[];
    /** Installation-wide; increases on every group create, delete and reparent. */
    hierarchy_revision: number;
  } | null;
}

export type IdentityIntrospectResponse = { active: true; user_id: string; token_id: string; scopes: string[] } | { active: false };

/** The groups the user is a DIRECT member of. */
export interface IdentityGroupsResponse { groups: Array<{ id: string; handle: string; name: string; parent_id: string | null }> }
