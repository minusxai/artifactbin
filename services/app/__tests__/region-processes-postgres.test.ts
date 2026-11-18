/**
 * TWO APP PROCESSES ON A REAL POSTGRESQL: the two-process scenario (region-processes-scenario.ts) on TWO connection
 * pools of a test-owned disposable PostgreSQL 17 (@artifactbin/test-support/docker), each with its own LISTEN
 * connection: concurrent transactions really race on FOR UPDATE and NOTIFY really crosses connections. This is as
 * close to two processes as a test file gets: the code paths are the process's, and nothing in them is shared through
 * memory. In the `integration` project; region-processes.test.ts runs the same scenario on the harness's PGLite.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { identityForUser } from '@/lib/accounts';
import { canonicalizeHtmlPage } from '@/lib/html-page';
import { editableRegions } from '@/lib/live-regions';
import { PostgresDb, SCHEMA_STATEMENTS } from '@/lib/platform';
import { identityViewStatements } from '@artifactbin/auth/identity-store/views';
import { dockerImage, startPostgres, type DisposablePostgres } from '@artifactbin/test-support/docker';
import { nativeHtml } from './native-html-fixture';
import { useAppHarness } from './harness';
import { BODY, concurrentTyping } from './region-processes-scenario';
import { seedArtifacts, seedShares } from '@/__tests__/rows';

useAppHarness();

describe.skipIf(!dockerImage('postgres:17-alpine'))('two connection pools over one PostgreSQL database', () => {
  const schema = `regions_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pools: PostgresDb[] = [], server: DisposablePostgres | undefined, postgres = '';
  beforeAll(async () => {
    server = await startPostgres();
    postgres = server.url;
    pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());
    admin = new pg.Pool({ connectionString: postgres });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const boot = new pg.Pool({ connectionString: postgres, options: `-c search_path=${schema}` });
    for (const statement of SCHEMA_STATEMENTS) await boot.query(statement);
    // The identity module's rows the access decisions read (its views in a deployment), only the columns they touch.
    await boot.query(`CREATE TABLE users (id text PRIMARY KEY, email text, kind text);
      CREATE TABLE groups (id text PRIMARY KEY, deleted_at timestamptz, parent_id text);
      CREATE TABLE group_members (group_id text, user_id text, role text, PRIMARY KEY (group_id, user_id))`);
    await boot.query(identityViewStatements({ auth: schema, app: schema, read: schema }, { sessions: false }).find((sql) => sql.includes(`VIEW ${schema}.group_admins`))!);
    await boot.end();
    pools = [0, 1].map(() => new PostgresDb(new pg.Pool({ connectionString: postgres, options: `-c search_path=${schema}`, max: 4 }) as never));
  }, 120_000);
  afterAll(async () => {
    // A pool ends only once its clients are back; the one holding this process's LISTENs never is, so it is destroyed.
    for (const pool of pools) { (pool as unknown as { listenClient: { release(destroy: boolean): void } | null }).listenClient?.release(true); await pool.close(); }
    await admin?.end();
    server?.stop();
  });

  it('serialize concurrent updates racing on row locks and deliver every one through NOTIFY across connections', async () => {
    const [first] = pools;
    const page = canonicalizeHtmlPage(nativeHtml(BODY));
    await first!.query("INSERT INTO users (id, email, kind) VALUES ('alice', 'mxmx_test_pg_alice@example.com', 'account'), ('bob', 'mxmx_test_pg_bob@example.com', 'account')");
    await seedArtifacts(first!, { id: 'pgpage', token_id: 'tok_pg', user_id: 'alice', format: 'html', visibility: 'private', version: 1, source: page.html, meta: JSON.stringify({ htmlIdentity: page.ledger }) });
    await seedShares(first!, { artifact_id: 'pgpage', email: 'mxmx_test_pg_bob@example.com', role: 'editor' });
    await concurrentTyping({
      pageId: 'pgpage', regionId: editableRegions(page.html)[0]!.id,
      alice: identityForUser('alice', null), bob: identityForUser('bob', null),
      dbs: [async () => pools[0]!, async () => pools[1]!],
      headVersion: async () => (await first!.query<{ version: number }>("SELECT version FROM artifacts WHERE id = 'pgpage'")).rows[0]!.version,
    });
  });
});
