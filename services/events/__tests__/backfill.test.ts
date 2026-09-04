/**
 * The legacy analytics rows, copied into the log once: the mapping, the
 * identity, the count, and that a second run copies nothing.
 *
 * Seeded RED by the orchestrator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Queryable } from '@artifactbin/contracts';
import { backfillAnalyticsEvents, backfillSql, ensureEventsSchema } from '@artifactbin/events/local';

const SCHEMA = 'evt_bf';
const pg = new PGlite();
const db: Queryable = {
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await pg.query<T>(sql, params)).rows }),
};
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeAll(async () => {
  // The app's declaration of the legacy table (lib/schema.ts ANALYTICS_EVENTS), verbatim in shape.
  await db.query(`CREATE TABLE analytics_events (
    seq BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, artifact_id TEXT NOT NULL, user_id TEXT, client TEXT, visitor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await ensureEventsSchema(db, SCHEMA);
  const rows: Array<[string, string, string | null, string | null, string | null, string]> = [
    ['view', 'art001', 'usr_1', 'browser', 'v'.repeat(32), day(1)],
    ['view', 'art001', null, 'curl', null, day(2)],
    ['fork', 'art001', 'usr_2', 'claude-code', 'w'.repeat(32), day(0)],
    ['sse_connect', 'art001', null, null, null, day(0)],
    ['create', 'art002', 'usr_1', 'claude-code', 'v'.repeat(32), day(3)],
  ];
  for (const r of rows) await db.query('INSERT INTO analytics_events (event, artifact_id, user_id, client, visitor, created_at) VALUES ($1, $2, $3, $4, $5, $6)', r);
});
afterAll(() => pg.close());

const count = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${SCHEMA}.events`)).rows[0]!.n;

describe('backfillSql', () => {
  it('is one INSERT … SELECT that names the schema, the legacy table, and dedupes on id', () => {
    const sql = backfillSql({ schema: SCHEMA, from: 'analytics_events' });
    expect(sql).toMatch(new RegExp(`INSERT INTO ${SCHEMA}\\.events`));
    expect(sql).toMatch(/FROM analytics_events/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(sql.trim().split(';').filter(Boolean)).toHaveLength(1);
    expect(sql).toMatch(/'legacy:'\s*\|\|\s*seq/);
  });
  it('refuses a name that is not an identifier', async () => {
    await expect(backfillAnalyticsEvents(db, { schema: 'x; drop', from: 'analytics_events' })).rejects.toThrow(/identifier/);
    await expect(backfillAnalyticsEvents(db, { schema: SCHEMA, from: 'app.analytics_events; --' })).rejects.toThrow(/identifier/);
  });
});

describe('backfillAnalyticsEvents', () => {
  it('copies every row but sse_connect, with the identity, the time, the subject and the payload the log expects', async () => {
    expect(await backfillAnalyticsEvents(db, { schema: SCHEMA, from: 'analytics_events' })).toBe(4);
    expect(await count()).toBe(4);
    const legacy = (await db.query<{ seq: number; created_at: string }>("SELECT seq, created_at FROM analytics_events WHERE event = 'view' ORDER BY seq")).rows;
    const rows = (await db.query<Record<string, unknown>>(`SELECT * FROM ${SCHEMA}.events ORDER BY at`)).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const first = byId.get(`legacy:${legacy[0]!.seq}`)!;
    expect(first).toMatchObject({ source: 'app', verb: 'viewed', object_kind: 'artifact', object_id: 'art001', subject_kind: 'visitor', subject_id: 'v'.repeat(32), payload: { user_id: 'usr_1', client: 'browser' } });
    expect(new Date(first.at as string).toISOString()).toBe(new Date(legacy[0]!.created_at).toISOString());
    const anonymous = byId.get(`legacy:${legacy[1]!.seq}`)!;
    expect(anonymous).toMatchObject({ verb: 'viewed', subject_kind: null, subject_id: null, payload: { client: 'curl' } });
    expect(Object.keys(anonymous.payload as object)).not.toContain('user_id');
    expect(rows.map((r) => r.verb).sort()).toEqual(['created', 'forked', 'viewed', 'viewed']);
    expect(rows.some((r) => r.verb === 'sse_connect')).toBe(false);
  });
  it('a second run copies nothing and changes nothing', async () => {
    expect(await backfillAnalyticsEvents(db, { schema: SCHEMA, from: 'analytics_events' })).toBe(0);
    expect(await count()).toBe(4);
  });
});
