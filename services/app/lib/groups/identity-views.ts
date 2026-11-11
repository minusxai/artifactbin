/**
 * THE SHARED IDENTITY READS (contracts `IDENTITY_VIEWS`, cross-repository contract §2): schema `identity`, views only,
 * in the one database Artifactbin and MinusX share. MinusX reads who someone is from them in one statement, with no
 * network hop and no cache; the views expose exactly the facts it needs and never a secret, a hash or an email.
 * MinusX's database role holds USAGE on the schema and SELECT on the views, nothing on the tables behind them (a view
 * reads with its owner's, Artifactbin's, privileges). Created in combined mode only (server.ts): standalone
 * Artifactbin creates no schema it does not use.
 *
 * ONE DEFINITION OF EACH RULE. No view restates a rule the app applies elsewhere; each is built from the very SQL
 * the app's own check runs:
 *  - `users.active` is `canAuthenticateUser && canUseDeploymentIdentity`: `authenticatingUserSql` (lib/user-kinds)
 *    and `deploymentMemberSql` (lib/accounts), the fragments those two functions execute. The one part that is
 *    not data, the deployment mode (APP__DEPLOYMENT_MODE), is read from `identity_settings`, a row this process
 *    writes from its own settings at every boot (`ensureIdentityViews`): the view stays static SQL a test can pin
 *    and MinusX can copy, and MinusX never learns, let alone re-implements, the rule. No settings row: no user is
 *    active (the join yields nothing), so a missing boot fails closed. A test that changes the mode with
 *    `overrideConfig` must call `syncIdentitySettings` again: the row does not follow config on its own.
 *  - `tokens.live` is the bearer read's liveness by id (row, expiry, OAuth family fence: auth's `bearerLiveSql`,
 *    the fragment `createBearerReader` runs), the audience rule (an OAuth token only for one of this deployment's
 *    API origins, from the same settings row) and an active account (the two admissions the auth host applies).
 *  - `sessions.live` is the session authority's `live` (an unexpired Better Auth session row).
 *
 * Every view is `CREATE OR REPLACE`, never dropped and re-created, so the grants an operator gave MinusX's role
 * survive every boot; Postgres refuses a replace that removes or retypes a column, so such a change is a
 * deliberate migration and a contract change (contracts `IDENTITY_VIEWS`). App tables are unqualified (the app's
 * search_path, as all boot DDL); the auth schema is named. `npm run render:schema` writes these statements, with
 * the default auth schema, to IDENTITY.sql; MinusX's tests apply a byte-for-byte copy of that file.
 */
import {API_RESOURCE_PATH,IDENTITY_SCHEMA,type Queryable} from '@artifactbin/contracts';
import {bearerLiveSql} from '@artifactbin/auth';
import {ALIAS_ORIGINS,PUBLIC_BASE_URL,deploymentConfig} from '../platform';
import {authenticatingUserSql} from '../user-kinds';
import {deploymentMemberSql} from '../accounts';

const SETTINGS_ID = 'installation';
const plain = (value: string) => {
 if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error(`identity views: "${value}" is not a plain lowercase identifier`);
 return value;
};

/** The DDL, in order. `authSchema` is AUTH__SCHEMA (Better Auth's `session`, the OAuth `credentials`). */
export function identityViewStatements(authSchema = 'auth'): string[] {
 const auth = plain(authSchema), id = IDENTITY_SCHEMA;
 const token = bearerLiveSql({auth, tokens: 'tokens'});
 return [
  `CREATE SCHEMA IF NOT EXISTS ${id}`,
  `CREATE OR REPLACE VIEW ${id}.groups AS
  SELECT g.id, g.handle, g.name, g.parent_id FROM groups g WHERE g.deleted_at IS NULL`,
  `CREATE OR REPLACE VIEW ${id}.memberships AS
  SELECT m.group_id, m.user_id FROM group_members m JOIN groups g ON g.id = m.group_id WHERE g.deleted_at IS NULL`,
  `CREATE OR REPLACE VIEW ${id}.hierarchy AS
  SELECT h.revision FROM group_hierarchy h WHERE h.id = 'installation'`,
  `CREATE OR REPLACE VIEW ${id}.users AS
  SELECT u.id, (${authenticatingUserSql('u')}
    AND (s.deployment_mode = 'public' OR ${deploymentMemberSql('u.id')})) AS active
  FROM users u JOIN identity_settings s ON s.id = '${SETTINGS_ID}'`,
  `CREATE OR REPLACE VIEW ${id}.sessions AS
  SELECT s.id, s."userId" AS user_id, (s."expiresAt" > now()) AS live FROM ${auth}.session s`,
  `CREATE OR REPLACE VIEW ${id}.tokens AS
  SELECT t.id, t.user_id, array_remove(regexp_split_to_array(coalesce(t.scope, ''), '\\s+'), '') AS scopes,
    (${token.live}
      AND t.user_id IS NOT NULL AND (COALESCE(t.audience,'') = '' OR t.audience = ANY(s.api_audiences))
      AND COALESCE(u.active, false)) AS live
  FROM tokens t
    ${token.fence}
    JOIN identity_settings s ON s.id = '${SETTINGS_ID}'
    LEFT JOIN ${id}.users u ON u.id = t.user_id`,
 ];
}

/** This process's settings into the row the views read: the deployment mode and the API audiences. */
export async function syncIdentitySettings(db: Queryable): Promise<void> {
 const origins = [...new Set([new URL(PUBLIC_BASE_URL).origin, ...ALIAS_ORIGINS])];
 await db.query(`INSERT INTO identity_settings(id,deployment_mode,api_audiences) VALUES($1,$2,$3)
  ON CONFLICT (id) DO UPDATE SET deployment_mode=excluded.deployment_mode,api_audiences=excluded.api_audiences`,
  [SETTINGS_ID, deploymentConfig().mode, origins.map(origin => `${origin}${API_RESOURCE_PATH}`)]);
}

/**
 * The boot step (server.ts, combined mode; after the auth tables exist, since a view checks its sources): the
 * schema and views, then the settings row. One transaction under an advisory lock, so replicas booting together do
 * not race `CREATE OR REPLACE VIEW`.
 */
export async function ensureIdentityViews(db: Queryable & {transaction<T>(fn:(tx:Queryable)=>Promise<T>):Promise<T>}, authSchema = 'auth'): Promise<void> {
 await db.transaction(async tx => {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.views'))");
  for (const statement of identityViewStatements(authSchema)) await tx.query(statement);
  await syncIdentitySettings(tx);
 });
}
