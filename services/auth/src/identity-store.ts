/**
 * THE IDENTITY STORE: the local implementation of contracts `IdentityService`, the only writer of
 * `IDENTITY_OWNED_TABLES`. A single-process install and the tests run it on the app's own database; the auth host
 * serves the same object over HTTP (`./session-authority`, `IDENTITY_CALL_PATH`) on its own connection, naming the
 * app's schema. Accounts, handles and tokens: ./identity-store/accounts; groups, membership, invitations and the tree:
 * ./identity-store/groups; the group mail outbox: ./identity-store/mail.
 */
import type {IdentityService,Queryable,TransactionalQueryable} from '@artifactbin/contracts';
import type {Pool} from 'pg';
import {accountMethods} from './identity-store/accounts';
import {groupMethods} from './identity-store/groups';
import {mailMethods} from './identity-store/mail';
import {identityTables} from './identity-store/tables';

export interface IdentityStoreOptions {
  /** The database: queries, and transactions on a connection of their own. */
  db: TransactionalQueryable;
  /** APP__SCHEMA when the connection's search_path is not the app's (the proxy); absent: the default schema. */
  appSchema?: string;
  /** The test domain (TEST_DOMAIN): a test account invites only addresses there. */
  testDomain?: string;
}

export function createIdentityStore(options: IdentityStoreOptions): IdentityService {
  const t = identityTables(options.appSchema), db = retrying(options.db);
  return {...accountMethods(db, t), ...groupMethods(db, t, {testDomain: options.testDomain}), ...mailMethods(db, t)};
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

/**
 * The rows identity keeps from the first boot: the hierarchy revision's one row (the `identity.hierarchy` view's row
 * before any topology change). Idempotent; the identity host runs it at boot.
 */
export async function ensureIdentityRows(db: Queryable, appSchema?: string): Promise<void> {
  await db.query(`INSERT INTO ${identityTables(appSchema).group_hierarchy}(id,revision) VALUES('installation',0) ON CONFLICT (id) DO NOTHING`);
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
