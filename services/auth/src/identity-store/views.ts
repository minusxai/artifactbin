/**
 * THE IDENTITY READ SURFACE: one thin view per identity table, in the read schema (IDENTITY__SCHEMA, default
 * `identity`), named as the table and exposing it as it is minus `SECRET_COLUMNS` (no filtering: readers keep
 * `deleted_at IS NULL` themselves), plus computed rule columns that cost nothing unless selected:
 *  - `users.active`: may sign in and act on this deployment (`authenticatingUserSql` and, in a company deployment,
 *    `deploymentMemberSql`, over the deployment mode in `identity_settings`; no settings row: nobody is active);
 *  - `tokens.scopes` (the scope list) and `tokens.live`: the bearer read's own rule (row, expiry, OAuth family
 *    fence), an audience of this deployment's API or of a configured service (`identity_settings.service_audiences`,
 *    IDENTITY__SERVICE_AUDIENCES) and an active account; a reader accepting a token checks its `audience` itself;
 *  - `sessions` (Better Auth's `session`, minus its token) and `sessions.live`: unexpired.
 * The app reads these exactly as any other reader does: its search_path is `<app>, <read schema>`, so `FROM users` is this
 * view. Each view's FROM is its one table (rule columns are scalar subqueries), so a view stays auto-updatable for a
 * single-role install's fixtures and inlines into the reader's plan.
 *
 * Views read with their owner's (the identity role's) privileges: in a split-role database readers hold SELECT on
 * these views and nothing on the base tables. Every name in a definition is schema-qualified, so a definition does
 * not depend on who runs it.
 */
import type {Table} from '@artifactbin/contracts';
import {bearerLiveSql} from '../identity/bearer';
import {authenticatingUserSql,deploymentMemberSql,type RuleNames} from './rules';
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

/** Each view's name and columns, in order: the cross-repository read contract (contracts `IDENTITY_VIEWS` pins it). */
export function identityViewColumns(): Record<string, string[]> {
  const views: Record<string, string[]> = {};
  for (const table of IDENTITY_TABLES) views[table.name] = exposed(table.name, columnsOf(table));
  views.users!.push('active');
  views.tokens!.push('scopes', 'live');
  views.sessions = [...exposed('session', SESSION_COLUMNS), 'live'];
  return views;
}

/** The view DDL, in dependency order (`tokens` reads `users`). `sessions` only where Better Auth's table exists. */
export function identityViewStatements(schemas: IdentitySchemas, options: {sessions?: boolean} = {}): string[] {
  const auth = plainIdentifier(schemas.auth, 'auth schema'), app = plainIdentifier(schemas.app, 'app schema'), read = plainIdentifier(schemas.read, 'read schema');
  const names: RuleNames = {users: `${auth}.users`, deploymentMembers: `${app}.deployment_members`, deploymentState: `${app}.deployment_state`};
  const settings = `${app}.identity_settings`;
  const views = identityViewColumns();
  const plain = (table: string, alias: string, extra: string[] = []) =>
    [...views[table]!.filter(column => !extra.includes(column)).map(column => `${alias}.${quoted(column)}`)];
  const statements: string[] = [];
  for (const table of IDENTITY_TABLES.map(t => t.name)) {
    if (table === 'users') {
      statements.push(`CREATE OR REPLACE VIEW ${read}.users AS
  SELECT ${plain('users', 'u', ['active']).join(', ')},
    COALESCE((SELECT ${authenticatingUserSql('u', names)} AND (s.deployment_mode = 'public' OR ${deploymentMemberSql('u.id', names)})
      FROM ${settings} s WHERE s.id = 'installation'), false) AS active
  FROM ${auth}.users u`);
    } else if (table === 'tokens') {
      const {exists} = bearerLiveSql({auth, tokens: `${auth}.tokens`});
      statements.push(`CREATE OR REPLACE VIEW ${read}.tokens AS
  SELECT ${plain('tokens', 't', ['scopes', 'live']).join(', ')},
    array_remove(regexp_split_to_array(coalesce(t.scope, ''), '\\s+'), '') AS scopes,
    (${exists} AND t.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM ${settings} s WHERE s.id = 'installation' AND (COALESCE(t.audience, '') = '' OR t.audience = ANY(s.api_audiences) OR t.audience = ANY(s.service_audiences)))
      AND COALESCE((SELECT u.active FROM ${read}.users u WHERE u.id = t.user_id), false)) AS live
  FROM ${auth}.tokens t`);
    } else {
      statements.push(`CREATE OR REPLACE VIEW ${read}.${table} AS
  SELECT ${plain(table, 'x').join(', ')} FROM ${auth}.${table} x`);
    }
  }
  if (options.sessions !== false) statements.push(`CREATE OR REPLACE VIEW ${read}.sessions AS
  SELECT ${plain('sessions', 's', ['live']).join(', ')}, (s."expiresAt" > now()) AS live FROM ${auth}.session s`);
  return statements;
}

