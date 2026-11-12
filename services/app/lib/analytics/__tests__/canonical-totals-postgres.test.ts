/** Real READ COMMITTED overlap proof on a test-owned disposable PostgreSQL 17 container.
 * The integration lane provisions the image; missing Docker or startup failures fail this suite.
 * PGLite's serialized connection cannot exercise a fold waiting behind another connection's lock. */
// harness-exempt: this suite owns a disposable PostgreSQL database, never the app harness database
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';
import { EVENTS_SCHEMA, PostgresDb, SCHEMA_STATEMENTS, envelope, type Db } from '@/lib/platform';
import { canonicalViewTotals } from '../view-totals';

const barrier = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe('canonical folds over independent PostgreSQL connections', () => {
  let container = '';
  let pool: Pool;
  let db: Db;
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=pw',
      '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' })
      .trim().split('\n')[0]!.split(':').at(-1));
    pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'postgres', max: 8,
      connectionTimeoutMillis: 1_000 });
    for (let attempt = 0; ; attempt++) {
      try { await pool.query('SELECT 1'); break; }
      catch (error) {
        if (attempt >= 120) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    db = new PostgresDb(pool as unknown as ConstructorParameters<typeof PostgresDb>[0]);
    for (const statement of SCHEMA_STATEMENTS.filter(sql => /^CREATE TABLE IF NOT EXISTS canonical_view_/.test(sql))) await db.query(statement);
    await ensureEventsSchema(db, EVENTS_SCHEMA);
  }, 120_000);
  afterAll(async () => {
    try { await pool?.end(); }
    finally {
      if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    }
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
