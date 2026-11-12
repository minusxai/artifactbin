/** Real READ COMMITTED overlap proof. ANALYTICS_TEST_DATABASE_URL must name a disposable database;
 * this suite creates and drops only its canonical derived tables and configured events schema.
 * PGLite's serialized connection cannot exercise a fold waiting behind another connection's lock. */
// harness-exempt: this suite owns a disposable PostgreSQL database, never the app harness database
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';
import { EVENTS_SCHEMA, PostgresDb, SCHEMA_STATEMENTS, envelope, type Db } from '@/lib/platform';
import { canonicalViewTotals } from '../view-totals';

const database = process.env.ANALYTICS_TEST_DATABASE_URL;
const barrier = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe.skipIf(!database)('canonical folds over independent PostgreSQL connections', () => {
  let pool: Pool;
  let db: Db;
  beforeAll(async () => {
    pool = new Pool({ connectionString: database, max: 8 });
    db = new PostgresDb(pool as unknown as ConstructorParameters<typeof PostgresDb>[0]);
    for (const statement of SCHEMA_STATEMENTS.filter(sql => /^CREATE TABLE IF NOT EXISTS canonical_view_/.test(sql))) await db.query(statement);
    await ensureEventsSchema(db, EVENTS_SCHEMA);
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP TABLE IF EXISTS canonical_view_visitors,canonical_view_totals; DROP SCHEMA IF EXISTS ${EVENTS_SCHEMA} CASCADE`);
    await pool.end();
  });

  it('waits in sorted artifact order, then folds the new snapshot including late appends exactly once', async () => {
    const writer = createEvents({ db, schema: EVENTS_SCHEMA });
    const event = (id: string, visitor: string, artifact: string) => ({
      ...envelope({ kind: 'visitor', id: visitor }, 'viewed', { kind: 'artifact', id: artifact }, {}),
      id, at: '2026-01-01T00:00:00Z',
    });
    await writer.emit([event('a1', 'v1', 'a'), event('a2', 'v1', 'a'), event('b1', 'v1', 'b')]);
    const locked = barrier(), resume = barrier();
    const held: Pick<Db, 'query' | 'transaction'> = {
      query: db.query.bind(db),
      transaction: fn => db.transaction(tx => fn({
        query: async <T,>(sql: string, args?: unknown[]) => {
          const result = await tx.query<T>(sql, args);
          if (sql.includes('INSERT INTO canonical_view_totals AS c')) {
            locked.resolve();
            await resume.promise;
          }
          return result;
        },
      })),
    };
    const first = canonicalViewTotals(held, ['a', 'b']);
    await Promise.race([locked.promise, first.then(() => { throw new Error('first fold did not hold its lock'); })]);
    const second = canonicalViewTotals(db, ['b', 'a']);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO canonical_view_totals AS c%'`);
        expect(waiting.rows[0].n).toBe(1);
      });
      await writer.emit([event('late', 'v2', 'a')]);
    } finally {
      resume.resolve();
      await Promise.allSettled([first, second]);
    }
    const results = await Promise.all([first, second]);
    for (const result of results) expect(Object.fromEntries(result)).toMatchObject({ a: 2, b: 1 });
    expect(Object.fromEntries(await canonicalViewTotals(db, ['a', 'b']))).toEqual({ a: 2, b: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM canonical_view_visitors')).rows[0].n).toBe(3);
  });
});
