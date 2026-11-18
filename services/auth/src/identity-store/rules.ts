/**
 * THE ACCOUNT RULES AS SQL, one spelling each, run by the app's own checks (unqualified names: its search_path
 * resolves `users` to the identity read view) and built into the identity views' `active` and `live` columns
 * (qualified names: a view's definition must not depend on who creates it). `names` says where each table is.
 */
export interface RuleNames {
  /** The account rows: `users` (the reader's view) or `<auth>.users` (the base table). */
  users: string;
  /** The app's company admission rows. */
  deploymentMembers: string;
  deploymentState: string;
}
const READER_NAMES: RuleNames = {users: 'users', deploymentMembers: 'deployment_members', deploymentState: 'deployment_state'};

/** Over the `users` row aliased `alias`: a live test user whose parent is an email account. */
export const liveTestuserWithParentSql = (alias: string, names: RuleNames = READER_NAMES): string => `(${alias}.kind = 'testuser' AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now()) AND EXISTS
  (SELECT 1 FROM ${names.users} parent WHERE parent.id = ${alias}.parent_user_id AND parent.kind = 'account' AND parent.email IS NOT NULL))`;

/** Over the `users` row aliased `alias`: may this identity hold a credential at all (an email account, or a live test user of one). */
export const authenticatingUserSql = (alias: string, names: RuleNames = READER_NAMES): string =>
  `((${alias}.kind='account' AND ${alias}.email IS NOT NULL) OR ${liveTestuserWithParentSql(alias, names)})`;

/**
 * Over the user whose id is the SQL expression `id`: an admitted member of a company deployment, directly or as the
 * live test user of one once setup is complete. The mode is NOT in it: a public deployment admits everyone first.
 */
export const deploymentMemberSql = (id: string, names: RuleNames = READER_NAMES): string => `(EXISTS (SELECT 1 FROM ${names.deploymentMembers} dm WHERE dm.user_id=${id})
  OR EXISTS (SELECT 1 FROM ${names.users} tu JOIN ${names.deploymentMembers} pm ON pm.user_id=tu.parent_user_id JOIN ${names.deploymentState} ds ON ds.id='company' AND ds.setup_complete=true
   WHERE tu.id=${id} AND ${liveTestuserWithParentSql('tu', names)}))`;

/** Where the group tree's rows are for `groupAdminsSql`: the base tables (qualified) or the reader's views. */
export interface GroupNames {groups: string; group_members: string}

/**
 * THE ADMIN RULE, one spelling: who is an EFFECTIVE ADMIN of each live group, and through which group. A person
 * holding `admin` directly on a group or on any ancestor of it, climbing through live groups only (a deleted ancestor
 * ends the climb), administers it; `via_group_id` is the group the direct `admin` row is on, the nearest when several
 * qualify (the group itself for a direct admin). Editor and Member never flow down, and membership stays the direct
 * rows (`group_members`). Columns `(group_id, user_id, via_group_id)`, one row per live group and effective admin.
 * The `group_admins` read view is exactly this (./views); the identity module's own checks run it over the base
 * tables (./groups `effectiveAdminVia`). A filter on `group_id` reaches the `groups` scan, so a one-group question
 * climbs one chain.
 */
export const groupAdminsSql = (names: GroupNames): string => `SELECT g.id AS group_id, a.user_id, a.via_group_id FROM ${names.groups} g CROSS JOIN LATERAL (
    WITH RECURSIVE up(id, depth) AS (SELECT g.id, 0 UNION ALL SELECT p.id, up.depth+1 FROM up JOIN ${names.groups} c ON c.id=up.id JOIN ${names.groups} p ON p.id=c.parent_id WHERE p.deleted_at IS NULL AND up.depth<10000)
    SELECT DISTINCT ON (m.user_id) m.user_id, up.id AS via_group_id FROM up JOIN ${names.group_members} m ON m.group_id=up.id AND m.role='admin' ORDER BY m.user_id, up.depth) a
  WHERE g.deleted_at IS NULL`;
