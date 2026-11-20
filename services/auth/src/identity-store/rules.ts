/**
 * THE ACCOUNT RULES AS SQL, one spelling each, run by the app's own checks (unqualified names: its search_path
 * resolves `users` to the identity read view) and built into the identity views' `active` and `live` columns
 * (qualified names: a view's definition must not depend on who creates it). `names` says where each table is.
 * The app asks them through the three questions at the end (over its own `users` read view), never as SQL.
 */
import type {Queryable} from '@artifactbin/contracts/db';

export interface RuleNames {
  /** The account rows: `users` (the reader's view) or `<auth>.users` (the base table). */
  users: string;
  /** The app's company admission rows. */
  deploymentMembers: string;
  deploymentState: string;
}
const READER_NAMES: RuleNames = {users: 'users', deploymentMembers: 'deployment_members', deploymentState: 'deployment_state'};

/** Over the `users` row aliased `alias`: a live test user whose parent is an email account. */
const liveTestuserWithParentSql = (alias: string, names: RuleNames = READER_NAMES): string => `(${alias}.kind = 'testuser' AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now()) AND EXISTS
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

/**
 * HOLDING AT LEAST A LEVEL on a group (contracts identity-service `GROUP_SIGN_IN_RULE`), one spelling: does the person
 * whose id is the SQL expression `user` hold at least `level` (an SQL expression, `'member'` or `'editor'`; anything
 * else holds nothing) on the live group `group`. An admin (a direct `admin` row, or an effective admin through an
 * ancestor: `groupAdminsSql`) holds editor and member; a direct `editor` row holds editor and member; a direct
 * `member` row holds member. Editor and Member never flow down the tree. The mint's guard and the `tokens` view's
 * `live` both run it (./accounts `mintGroupSignIn`, ./views).
 */
export const groupLevelHeldSql = (names: GroupNames, user: string, group: string, level: string): string => `(${level} IN ('member','editor') AND (EXISTS (
    SELECT 1 FROM ${names.group_members} held JOIN ${names.groups} held_group ON held_group.id=held.group_id AND held_group.deleted_at IS NULL
    WHERE held.group_id=${group} AND held.user_id=${user} AND (held.role='admin' OR held.role=${level} OR (held.role='editor' AND ${level}='member')))
  OR EXISTS (SELECT 1 FROM (${groupAdminsSql(names)}) held_admin WHERE held_admin.group_id=${group} AND held_admin.user_id=${user})))`;

/**
 * A GROUP'S APPROVAL OF A SERVICE THAT STILL STANDS (contracts service-audiences `GROUP_SIGN_IN_PATH`), over the
 * `group_sign_in_grants` row aliased `g`: not revoked, at `member` or `editor`, of a live group, and approved by someone
 * who is not a test account (a test account approves nothing, and an approval one made issues and keeps nothing). One
 * spelling for the mint (./accounts `mintServiceGroupSignIn`), the service's list of its approvals and the `tokens`
 * view's `live`. Whether the service is still configured, with the opt-in, at the origin the approval recorded
 * (`service_origin`) is configuration, decided where that is known (contracts `groupSignInServiceConfigured`).
 */
export const serviceGrantStandsSql = (g: string, names: {groups: string; users: string}): string => `(${g}.deleted_at IS NULL AND ${g}.role IN ('member','editor')
      AND EXISTS (SELECT 1 FROM ${names.groups} granted_group WHERE granted_group.id=${g}.group_id AND granted_group.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM ${names.users} approver WHERE approver.id=${g}.approved_by AND approver.test_account))`;

/**
 * A GROUP'S SIGN-IN, LIVE BY ITS AUTHORISATION (contracts identity-service `GROUP_SIGN_IN_RULE`), over the `tokens`
 * row aliased `t` whose `group_id` is set: no person on the row, a level that is never `admin`, the group live, and
 *  - a person's (no `grant_id`): the person who authorised it (`issued_by`) active (`active(id)`, an SQL boolean) and
 *    still holding at least that level there;
 *  - a service's (`grant_id`: contracts service-audiences `GROUP_SIGN_IN_PATH`): the approval it was issued under still
 *    standing (`serviceGrantStandsSql`), for this group, level and service (`issued_by`), whoever approved it.
 *    Its service's configuration is the bearer read's and the app's (contracts `groupSignInServiceConfigured`).
 * The token's own row, expiry and (a person's) refresh-family fence are the bearer read's (../identity/bearer).
 */
export const groupSignInLiveSql = (t: string, names: GroupNames & {group_sign_in_grants: string; users: string}, active: (id: string) => string): string => `(${t}.user_id IS NULL AND ${t}.issued_by IS NOT NULL
      AND ${t}.group_role IN ('member','editor') AND EXISTS (SELECT 1 FROM ${names.groups} signed_group WHERE signed_group.id=${t}.group_id AND signed_group.deleted_at IS NULL)
      AND CASE WHEN ${t}.grant_id IS NULL THEN ${active(`${t}.issued_by`)} AND ${groupLevelHeldSql(names, `${t}.issued_by`, `${t}.group_id`, `${t}.group_role`)}
        ELSE EXISTS (SELECT 1 FROM ${names.group_sign_in_grants} signed_grant WHERE signed_grant.id=${t}.grant_id AND ${serviceGrantStandsSql('signed_grant', names)}
          AND signed_grant.group_id=${t}.group_id AND signed_grant.role=${t}.group_role AND signed_grant.service_id=${t}.issued_by) END)`;

/** May this user hold a credential at all (an email account, or a live test user of one), over the reader's views. */
export async function isAuthenticatingUser(db: Queryable, userId: string): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM users u WHERE u.id=$1 AND ${authenticatingUserSql('u')}`, [userId])).rows.length > 0;
}

/** The email account a live test user belongs to, or null when the user is not one (over the reader's views). */
export async function authenticatingTestParent(db: Queryable, userId: string): Promise<string | null> {
  return (await db.query<{parent_user_id: string}>(`SELECT u.parent_user_id FROM users u WHERE u.id=$1 AND ${liveTestuserWithParentSql('u')}`, [userId])).rows[0]?.parent_user_id ?? null;
}

/** An admitted member of a company deployment, directly or as a member's live test user (over the reader's views). */
export async function isDeploymentMember(db: Queryable, userId: string): Promise<boolean> {
  return (await db.query<{admitted: boolean}>(`SELECT ${deploymentMemberSql('$1::text')} AS admitted`, [userId])).rows[0]?.admitted === true;
}
