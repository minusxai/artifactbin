/**
 * THE IDENTITY READ SURFACE: one thin view per identity table, in the read schema (IDENTITY__SCHEMA, default
 * `identity`), named as the table and exposing it as it is minus `SECRET_COLUMNS` (no filtering: readers keep
 * `deleted_at IS NULL` themselves), plus computed rule columns that cost nothing unless selected:
 *  - `users.active`: may sign in and act on this deployment (`authenticatingUserSql` and, in a company deployment,
 *    `deploymentMemberSql`, over the deployment mode in `identity_settings`; no settings row: nobody is active);
 *  - `users.default_group_id`: a live direct membership, preferring the explicit publishing group, then the earliest
 *    subgroup across all trees, then the earliest root. NULL without a live membership. A preference grants no access.
 *  - `tokens.scopes` (the scope list) and `tokens.live`: the bearer read's own rule (row, expiry, OAuth family or, for a
 *    run sign-in, parent-credential
 *    fence), an audience of this deployment's API or of a configured service (`identity_settings.service_audiences`,
 *    IDENTITY__SERVICE_AUDIENCES) and an active account, or for a GROUP's sign-in (`group_id` set, `user_id` projected from the personal issuer for audit) its
 *    authorisation (./rules `groupSignInLiveSql`) instead; a reader accepting a token checks its `audience` itself;
 *  - `sessions` (Better Auth's `session`, minus its token) and `sessions.live`: unexpired;
 *  - `group_admins`, the one computed view: each live group's effective admins and the group their direct `admin`
 *    row is on (./rules `groupAdminsSql`, the rule the identity module's own checks run), so no reader re-derives it.
 * The app reads these exactly as any other reader does: its search_path is `<app>, <read schema>`, so `FROM users` is this
 * view. Each table's view's FROM is its one table (rule columns are scalar subqueries), so it stays auto-updatable for a
 * single-role install's fixtures and inlines into the reader's plan.
 *
 * Views read with their owner's (the identity role's) privileges: in a split-role database readers hold SELECT on
 * these views and nothing on the base tables. Every name in a definition is schema-qualified, so a definition does
 * not depend on who runs it.
 */
import type {Table} from '@artifactbin/contracts/schema';
import {bearerLiveSql} from '../identity/bearer';
import {authenticatingUserSql,deploymentMemberSql,groupAdminsSql,groupSignInLiveSql,type RuleNames} from './rules';
import {IDENTITY_TABLES,SECRET_COLUMNS} from './schema';

export interface IdentitySchemas {
  /** AUTH__SCHEMA: the identity module's own schema (the base tables, Better Auth, the OAuth credentials). */
  auth: string;
  /** APP__SCHEMA: the app's schema (its admission rows and `identity_settings`, which `active` reads). */
  app: string;
  /** IDENTITY__SCHEMA: where the views are. */
  read: string;
}

/** Better Auth's session columns (its own migration declares the table, services/auth/src/auth/human.ts). */
const SESSION_COLUMNS = ['id', 'expiresAt', 'token', 'createdAt', 'updatedAt', 'ipAddress', 'userAgent', 'userId'];
const quoted = (column: string) => /^[a-z_][a-z0-9_]*$/.test(column) ? column : `"${column}"`;
const exposed = (table: string, columns: readonly string[]) => columns.filter(column => !(SECRET_COLUMNS[table] ?? []).includes(column));
const columnsOf = (table: Table) => table.columns.map(column => column.name);

export const plainIdentifier = (value: string, what: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`identity: ${what} "${value}" is not a plain lowercase identifier`);
  return value;
};

/**
 * Where each view's rule columns sit: after the table column that was last when they were added. A table column
 * declared later follows them, at the end of the view, so a column already in a view never moves and the boot (and a
 * reader applying IDENTITY.sql) replaces the view in place, appending, rather than dropping it.
 */
const RULE_COLUMNS: Readonly<Record<string, {after: string; rules: readonly string[]}>> = {
  users: {after: 'created_at', rules: ['active', 'default_group_id', 'handle']},
  tokens: {after: 'last_used_at', rules: ['scopes', 'live']},
};

/** Each view's name and columns, in order: the cross-repository read contract (contracts `IDENTITY_VIEWS` pins it). */
export function identityViewColumns(): Record<string, string[]> {
  const views: Record<string, string[]> = {};
  for (const table of IDENTITY_TABLES) {
    const columns = exposed(table.name, columnsOf(table)), placed = RULE_COLUMNS[table.name];
    if (!placed) { views[table.name] = columns; continue; }
    const at = columns.indexOf(placed.after) + 1;
    if (at === 0) throw new Error(`identity: the ${table.name} view's rule columns follow "${placed.after}", which the table no longer declares`);
    views[table.name] = [...columns.slice(0, at), ...placed.rules, ...columns.slice(at)];
  }
  views.group_admins = ['group_id', 'user_id', 'via_group_id'];
  views.sessions = [...exposed('session', SESSION_COLUMNS), 'live'];
  return views;
}

/** The view DDL, in dependency order (`tokens` reads `users`). `sessions` only where Better Auth's table exists. */
export function identityViewStatements(schemas: IdentitySchemas, options: {sessions?: boolean} = {}): string[] {
  const auth = plainIdentifier(schemas.auth, 'auth schema'), app = plainIdentifier(schemas.app, 'app schema'), read = plainIdentifier(schemas.read, 'read schema');
  const names: RuleNames = {users: `${auth}.users`, deploymentMembers: `${app}.deployment_members`, deploymentState: `${app}.deployment_state`};
  const settings = `${app}.identity_settings`;
  const views = identityViewColumns();
  /** The view's SELECT list in its column order: a table column as `alias.column`, a rule column as its expression. */
  const plain = (table: string, alias: string, rules: Record<string, string> = {}) =>
    views[table]!.map(column => rules[column] ?? `${alias}.${quoted(column)}`).map((item, i) => i === 0 ? item : item.startsWith('\n') ? `,${item}` : `, ${item}`).join('');
  const statements: string[] = [];
  for (const table of IDENTITY_TABLES.map(t => t.name)) {
    if (table === 'users') {
      statements.push(`CREATE OR REPLACE VIEW ${read}.users AS
  SELECT ${plain('users', 'u', {active: `
    COALESCE((SELECT ${authenticatingUserSql('u', names)} AND (s.deployment_mode = 'public' OR ${deploymentMemberSql('u.id', names)})
      FROM ${settings} s WHERE s.id = 'installation'), false) AS active`, default_group_id: `
    (SELECT m.group_id FROM ${auth}.group_members m
      JOIN ${auth}.groups g ON g.id=m.group_id AND g.deleted_at IS NULL
      LEFT JOIN ${auth}.account_preferences p ON p.user_id=m.user_id
      WHERE m.user_id=u.id
      ORDER BY (p.default_destination->>'type'='group' AND p.default_destination->>'id'=g.id) DESC NULLS LAST,
        (g.parent_id IS NULL), m.created_at, g.id COLLATE "C"
      LIMIT 1) AS default_group_id`, handle: 'u.username AS handle'})}
  FROM ${auth}.users u`);
    } else if (table === 'tokens') {
      const {exists} = bearerLiveSql({auth, tokens: `${auth}.tokens`, sessions: options.sessions !== false, groupConsents: true});
      statements.push(`CREATE OR REPLACE VIEW ${read}.tokens AS
  SELECT ${plain('tokens', 't', {user_id: 'CASE WHEN t.group_id IS NOT NULL AND t.grant_id IS NULL THEN t.issued_by ELSE t.user_id END AS user_id', scopes: `
    array_remove(regexp_split_to_array(coalesce(t.scope, ''), '\\s+'), '') AS scopes`, live: `
    (${exists}
      AND EXISTS (SELECT 1 FROM ${settings} s WHERE s.id = 'installation' AND (COALESCE(t.audience, '') = '' OR t.audience = ANY(s.api_audiences) OR t.audience = ANY(s.service_audiences)))
      AND CASE WHEN t.group_id IS NULL THEN t.user_id IS NOT NULL AND COALESCE((SELECT u.active FROM ${read}.users u WHERE u.id = t.user_id), false)
        ELSE ${groupSignInLiveSql('t', {groups: `${auth}.groups`, group_members: `${auth}.group_members`, group_sign_in_grants: `${auth}.group_sign_in_grants`, users: `${auth}.users`}, id => `COALESCE((SELECT issuer.active AND issuer.kind = 'account' AND NOT issuer.test_account FROM ${read}.users issuer WHERE issuer.id = ${id}), false)`)} END) AS live`})}
  FROM ${auth}.tokens t`);
    } else {
      statements.push(`CREATE OR REPLACE VIEW ${read}.${table} AS
  SELECT ${plain(table, 'x')} FROM ${auth}.${table} x`);
    }
  }
  statements.push(`CREATE OR REPLACE VIEW ${read}.group_admins AS
  ${groupAdminsSql({groups: `${auth}.groups`, group_members: `${auth}.group_members`})}`);
  if (options.sessions !== false) statements.push(`CREATE OR REPLACE VIEW ${read}.sessions AS
  SELECT ${plain('sessions', 's', {live: '(s."expiresAt" > now()) AS live'})} FROM ${auth}.session s`);
  return statements;
}

