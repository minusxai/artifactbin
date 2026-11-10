/**
 * Optional real-PostgreSQL proof of the feed position (CONTRACT §6): concurrent appends on separate pool connections
 * under READ COMMITTED never commit a position a reader has already passed. This test owns EVENTS_TEST_DATABASE_URL;
 * use a disposable database, never a deployment's. Skipped without it (PGLite has one connection and proves nothing
 * about concurrency).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { EventEnvelope, Queryable } from '@artifactbin/contracts';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';

const database = process.env.EVENTS_TEST_DATABASE_URL;
describe.skipIf(!database)('feed positions over concurrent PostgreSQL connections', () => {
  const schema = `feed_${randomBytes(6).toString('hex')}`;
  let pool: Pool;
  const queryable = (p: Pool): Queryable => ({ query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await p.query(sql, params)).rows as T[] }) });
  beforeAll(async () => { pool = new Pool({ connectionString: database, max: 12 }); await ensureEventsSchema(queryable(pool), schema); });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); } });

  it('a reader resuming after the highest position it saw never later finds a lower one committed', async () => {
    const writer = createEvents({ db: queryable(pool), schema });
    const event = (): EventEnvelope => ({ id: randomUUID(), at: new Date().toISOString(), source: 'app', subject_kind: 'user',
      subject_id: 'usr', verb: 'annotated', object_kind: 'artifact', object_id: 'doc', payload: { annotation_id: 'a' } });
    // Ten writers append small batches as fast as they can while one reader polls `position > cursor`.
    const writers = Array.from({ length: 10 }, async () => { for (let i = 0; i < 30; i++) await writer.publish([event(), event()]); });
    let done = false, cursor = 0n;
    const seen: bigint[] = [];
    const reader = (async () => {
      while (!done) {
        const rows = (await pool.query<{ p: string }>(`SELECT position::text AS p FROM ${schema}.events WHERE position > $1 ORDER BY position`, [String(cursor)])).rows;
        for (const row of rows) { seen.push(BigInt(row.p)); cursor = BigInt(row.p); }
      }
    })();
    await Promise.all(writers);
    done = true;
    await reader;
    const all = (await pool.query<{ p: string }>(`SELECT position::text AS p FROM ${schema}.events ORDER BY position`)).rows.map(r => BigInt(r.p));
    expect(all).toHaveLength(600);
    // Every committed position is above the reader's position when it was read: nothing landed behind the cursor.
    const tail = all.filter(p => p > cursor);
    expect([...seen, ...tail]).toEqual(all);
    // Dense too, since no id repeated: 1..600 with no gaps or duplicates.
    expect(all[0]).toBe(1n);
    expect(all.at(-1)).toBe(600n);
  }, 60_000);
});
