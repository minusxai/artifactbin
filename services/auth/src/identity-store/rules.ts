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
