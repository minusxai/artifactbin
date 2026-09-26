/**
 * THE SERVER'S ENGINE THREADS (src/pool.ts). The SQLite engine is synchronous,
 * so a statement holds the thread it runs on; the pool is what keeps a
 * server's own event loop — its health probe, its other requests — answering
 * while a query runs, and what replaces a thread that stops answering.
 */
import { describe, expect, it } from 'vitest';
import { serveSql } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { createSqlitePool } from '../src/pool';

/** Counts forever; only the engine's deadline stops it. */
const ENDLESS = { tables: {}, params: {}, queries: [{ name: 'slow', sql: 'with recursive c(n) as (select 1 union all select n + 1 from c) select count(*) as n from c' }] };

/**
 * When GET /health, sent 200 ms after ENDLESS, is answered — measured from the
 * moment ENDLESS was sent. The test shares its thread with the server, so an
 * engine running on that thread holds the test's own timer too: the answer
 * then lands only once the query has been stopped.
 */
async function healthDuringQuery(svc: ReturnType<typeof createSqliteSql>) {
  const http = serveSql(svc);
  const { url } = http.listen(0);
  try {
    const sent = performance.now();
    const running = fetch(`${url}/run`, { method: 'POST', body: JSON.stringify(ENDLESS) }).then((r) => r.json());
    await new Promise((resolve) => setTimeout(resolve, 200));
    const health = await fetch(`${url}/health`);
    return { status: health.status, answeredAt: performance.now() - sent, answer: await running };
  } finally { await http.close(); }
}

describe('a server keeps answering while a query runs', () => {
  it('on the worker threads, /health answers at once and the query stops at its deadline', async () => {
    const svc = createSql({ timeoutMs: 1500 }, { workers: 1 });
    try {
      const { status, answeredAt, answer } = await healthDuringQuery(svc);
      expect(status).toBe(200);
      expect(answeredAt).toBeLessThan(700);
      expect(answer.results.slow).toMatchObject({ timedOut: true });
    } finally { await svc.close(); }
  });

  it('in the calling thread the same query holds /health for its whole deadline — why a server uses threads', async () => {
    const { status, answeredAt } = await healthDuringQuery(createSqliteSql({ timeoutMs: 1500 }));
    expect(status).toBe(200);
    expect(answeredAt).toBeGreaterThan(1400);
  });
});

describe('a thread that stops answering', () => {
  it('is terminated and replaced, and its caller gets a timed-out failure rather than a hang', async () => {
    const pool = createSqlitePool({ timeoutMs: 200 }, { workers: 1, graceMs: 200, workerUrl: new URL('./fixtures/silent-worker.mjs', import.meta.url) });
    try {
      const started = performance.now();
      const first = await pool.run({ tables: {}, params: {}, queries: [{ name: 'q', sql: 'select 1' }] });
      expect(first.q).toMatchObject({ timedOut: true });
      expect(performance.now() - started).toBeLessThan(2000);
      // The replacement answers the next call the same way: the pool never wedges.
      expect((await pool.mutate({ table: { name: 't', rows: [], columns: [] }, sql: 'delete from t', params: {} }))).toMatchObject({ timedOut: true });
    } finally { await pool.close(); }
  });

  it('answers calls queued behind a busy thread in order, each on a free one', async () => {
    const pool = createSql({}, { workers: 2 });
    try {
      const answers = await Promise.all(Array.from({ length: 6 }, (_, i) => pool.run({ tables: {}, params: { i }, queries: [{ name: 'q', sql: 'select $i as i' }] })));
      expect(answers.map((a) => (a.q as unknown as { rows: Array<{ i: number }> }).rows[0]!.i)).toEqual([0, 1, 2, 3, 4, 5]);
    } finally { await pool.close(); }
  });
});
