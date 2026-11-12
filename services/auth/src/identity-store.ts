/**
 * THE IDENTITY STORE: the local implementation of contracts `IdentityService`, the only writer of
 * `IDENTITY_OWNED_TABLES`. A single-process install and the tests run it on the app's own database; the auth host
 * serves the same object over HTTP (`./session-authority`, `IDENTITY_CALL_PATH`) on its own connection, naming the
 * app's schema. Accounts, handles and tokens: ./identity-store/accounts; groups, membership, invitations and the tree:
 * ./identity-store/groups; the group mail outbox: ./identity-store/mail.
 */
import {IDENTITY_OWNED_TABLES,type IdentityService,type Queryable,type TransactionalQueryable} from '@artifactbin/contracts';
import {ensureTable} from '@artifactbin/utils';
import {ensureAuthSchema} from './schema';
import {IDENTITY_TABLES} from './identity-store/schema';
import {identityViewColumns,identityViewStatements,plainIdentifier,type IdentitySchemas} from './identity-store/views';
import type {Pool} from 'pg';
import {accountMethods} from './identity-store/accounts';
import {groupMethods} from './identity-store/groups';
import {mailMethods} from './identity-store/mail';
import {initializeGroupRoleModel} from './identity-store/group-role-migration';
import {identityTables} from './identity-store/tables';

export interface IdentityStoreOptions {
  /** The database: queries, and transactions on a connection of their own. */
  db: TransactionalQueryable;
  /** AUTH__SCHEMA: where the base tables are (default `auth`). */
  authSchema?: string;
  /** The test domain (TEST_DOMAIN): a test account invites only addresses there. */
  testDomain?: string;
}

export function createIdentityStore(options: IdentityStoreOptions): IdentityService {
  const t = identityTables(options.authSchema), db = retrying(options.db);
  return {
    ...accountMethods(db, t), ...groupMethods(db, t, {testDomain: options.testDomain}), ...mailMethods(db, t),
  };
}

/**
 * Two of the module's own writers can meet in opposite orders (a reparent's groups against an acceptance's): Postgres
 * aborts one with 40P01 (or 40001), nothing of it commits, and the whole transaction runs again, a bounded number of
 * times with a short jittered wait. Every transaction here is self-contained, so a rerun is the same write.
 */
function retrying(db: TransactionalQueryable): TransactionalQueryable {
  return {
    query: (sql, params) => db.query(sql, params),
    async transaction(fn) {
      for (let attempt = 1; ; attempt++) {
        try { return await db.transaction(fn); } catch (error) {
          const code = (error as {code?: string} | null)?.code;
          if ((code !== '40P01' && code !== '40001') || attempt >= 5) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20 * attempt));
        }
      }
    },
  };
}

/** The rows identity keeps from the first boot: the hierarchy revision's one row. Idempotent. */
async function ensureIdentityRows(db: Queryable, authSchema = 'auth'): Promise<void> {
  await db.query(`INSERT INTO ${identityTables(authSchema).group_hierarchy}(id,revision) VALUES('installation',0) ON CONFLICT (id) DO NOTHING`);
}

/** The identity read surface or base tables are not where they must be yet; the message says what to do. */
export class IdentityNotReady extends Error {}

const schemaExists = async (db: Queryable, schema: string) => (await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rows.length > 0;
/**
 * The columns the identity views read from the app's tables (./identity-store/views.ts and the SQL of ./identity-store/rules.ts:
 * `active`, `live`), which the app's boot adds. Keep in step with them: a view created before one exists fails with 42703.
 */
const APP_VIEW_COLUMNS: Record<string, string[]> = {
  deployment_members: ['user_id'],
  deployment_state: ['id', 'setup_complete'],
  identity_settings: ['id', 'deployment_mode', 'api_audiences', 'service_audiences'],
};
const relationKind = async (db: Queryable, schema: string, name: string) =>
  (await db.query<{relkind: string}>('SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2', [schema, name])).rows[0]?.relkind ?? null;

/**
 * THE IDENTITY HOST'S BOOT: its own schema and tables (`ensureAuthSchema`, `IDENTITY_TABLES` under AUTH__SCHEMA), the
 * hierarchy row and the read views (./identity-store/views), in one transaction under an advisory lock so hosts
 * booting together do not race. Idempotent; runs on every start of whoever hosts identity (the app's database open in
 * a single-process install, the auth host otherwise), and again once Better Auth's tables exist (the sessions view).
 *
 * A schema is created only when it does not exist (a role without database CREATE may own an existing one). Base
 * tables still in the APP's schema (a database from before this module owned them) are moved into AUTH__SCHEMA with
 * `ALTER TABLE … SET SCHEMA`, which keeps every row, index and constraint; that needs one role owning the table and
 * CREATE on AUTH__SCHEMA, as in a single-role install. In a split-role database the operator runs those statements
 * once (`identityMoveStatements`) and this refuses to boot (`IdentityNotReady`) until then. The app's tables the views
 * read (`deployment_members`, `deployment_state`, `identity_settings`) and the columns the views read from them are the app's boot's: without them this
 * answers `IdentityNotReady` too, for the host to retry. A view whose columns changed (or a view a former contract
 * named) is dropped and created again, once; readers keep their SELECT through the schema's default privileges.
 */
export async function ensureIdentitySchema(db: TransactionalQueryable, schemas: IdentitySchemas): Promise<void> {
  const auth = plainIdentifier(schemas.auth, 'auth schema'), app = plainIdentifier(schemas.app, 'app schema'), read = plainIdentifier(schemas.read, 'read schema');
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.schema'))");
    for (const table of ['deployment_members', 'deployment_state', 'identity_settings'])
      if (await relationKind(tx, app, table) !== 'r') throw new IdentityNotReady(`identity: the app's ${app}.${table} does not exist yet; boot the app first (it creates its own tables), then this host`);
    for (const [table, columns] of Object.entries(APP_VIEW_COLUMNS)) {
      const have = new Set((await tx.query<{column_name: string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [app, table])).rows.map(row => row.column_name));
      const missing = columns.filter(column => !have.has(column));
      if (missing.length) throw new IdentityNotReady(`identity: the app's ${app}.${table} has no ${missing.join(', ')} yet; boot the app first (it adds its own columns), then this host`);
    }
    await ensureAuthSchema(tx, auth);
    const moving: string[] = [];
    for (const table of IDENTITY_OWNED_TABLES)
      if (await relationKind(tx, app, table) === 'r' && !await relationKind(tx, auth, table)) moving.push(table);
    if (moving.length) {
      try { for (const table of moving) await tx.query(`ALTER TABLE ${app}.${table} SET SCHEMA ${auth}`); }
      catch (error) {
        if ((error as {code?: string}).code !== '42501') throw error;
        throw new IdentityNotReady(`identity: ${moving.map(table => `${app}.${table}`).join(', ')} must move to ${auth} once, as a superuser (identityMoveStatements), for example:\n${identityMoveStatements({auth, app, read, owner: '<the identity role>'}).join(';\n')};`);
      }
    }
    await ensureTable(tx, IDENTITY_TABLES, {schema: auth});
    await initializeGroupRoleModel(tx, auth);
    await ensureIdentityRows(tx, auth);
    if (!await schemaExists(tx, read)) await tx.query(`CREATE SCHEMA ${read}`);
    const sessions = await relationKind(tx, auth, 'session') === 'r';
    const wanted = identityViewColumns();
    const current = new Map<string, string[]>();
    for (const row of (await tx.query<{table_name: string; column_name: string}>(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.views v ON v.table_schema=c.table_schema AND v.table_name=c.table_name
       WHERE c.table_schema=$1 ORDER BY c.table_name, c.ordinal_position`, [read])).rows) current.set(row.table_name, [...current.get(row.table_name) ?? [], row.column_name]);
    const stale = [...current].filter(([name, columns]) => JSON.stringify(columns) !== JSON.stringify(wanted[name]));
    for (const [name] of stale) await tx.query(`DROP VIEW IF EXISTS ${read}.${name} CASCADE`);
    for (const statement of identityViewStatements({auth, app, read}, {sessions})) await tx.query(statement);
  });
}

/**
 * THE ONE-TIME MOVE for a split-role database whose identity tables (and identity views) the app role still owns, run
 * once by a superuser with every Artifactbin process stopped, before the new version boots: each base table moves into
 * AUTH__SCHEMA (rows, indexes and constraints with it) and is handed to the identity role, the read schema is handed to
 * it too, and the former views (the app role's) are dropped for the identity boot to create again. `owner` is the
 * identity role. In a single-role install `ensureIdentitySchema` moves the tables itself.
 */
export function identityMoveStatements(schemas: IdentitySchemas & {owner: string}): string[] {
  const auth = plainIdentifier(schemas.auth, 'auth schema'), app = plainIdentifier(schemas.app, 'app schema'), read = plainIdentifier(schemas.read, 'read schema');
  const owner = /^<.*>$/.test(schemas.owner) ? schemas.owner : plainIdentifier(schemas.owner, 'owner role');
  return [
    ...IDENTITY_OWNED_TABLES.flatMap(table => [`ALTER TABLE IF EXISTS ${app}.${table} SET SCHEMA ${auth}`, `ALTER TABLE IF EXISTS ${auth}.${table} OWNER TO ${owner}`]),
    `ALTER SCHEMA ${read} OWNER TO ${owner}`,
    `DROP VIEW IF EXISTS ${['groups', 'memberships', 'hierarchy', 'users', 'sessions', 'tokens'].map(view => `${read}.${view}`).join(', ')} CASCADE`,
  ];
}

/** A `pg` pool as the store's database: each transaction on one checked-out client, released after. */
export function identityDbOf(pool: Pool): TransactionalQueryable {
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({rows: (await pool.query(sql, params)).rows as T[]}),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({query: async <R>(sql: string, params?: unknown[]) => ({rows: (await client.query(sql, params)).rows as R[]})});
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
