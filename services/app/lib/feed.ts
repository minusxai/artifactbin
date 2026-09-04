/**
 * THE READER — every query the app makes against the events schema, and the
 * only module that names it. All of them are SELECTs joining the app's own
 * tables: the schema is `EVENTS_SCHEMA` (env), the table name is a literal,
 * the way the proxy reads `${APP__SCHEMA}.tokens`. The app role holds SELECT
 * on it and nothing more.
 *
 * A split deployment that runs no events service has no table: every read
 * here checks `to_regclass` first and answers EMPTY, never an error — the
 * home page must not break because telemetry is off.
 */
import type { EventEnvelope } from '@artifactbin/contracts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { getDb } from '@/lib/db';

export const FEED_DEFAULT_LIMIT = 50;

/**
 * The schema name is interpolated (a parameter cannot name a schema), so it is
 * validated ONCE, at import, against the identifier grammar — the same shape
 * the proxy demands of `APP__SCHEMA`. A deployment with a bad name fails to
 * boot rather than reaching a query builder with it.
 */
if (!/^[a-z_][a-z0-9_]*$/.test(EVENTS_SCHEMA)) {
  throw new Error(`EVENTS__SCHEMA is not an identifier: ${EVENTS_SCHEMA}`);
}

/** The row as postgres hands it back: `at` is a Date on pg and a string on PGLite, `payload` either an object or its text. */
interface EventRow extends Omit<EventEnvelope, 'at' | 'payload'> {
  at: string | Date;
  payload: Record<string, unknown> | string;
}

const envelopeOf = (row: EventRow): EventEnvelope => ({
  ...row,
  at: typeof row.at === 'string' ? row.at : row.at.toISOString(),
  payload: typeof row.payload === 'string' ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload,
});

/** Is there an events table to read? Cheap (`to_regclass`), asked per read; false is a documented state, not a fault. */
export async function eventsTablePresent(): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
  return r.rows[0]?.present === true;
}

/**
 * "What happened to what I own": every event whose object is one of the
 * user's artifacts, newest first — a view, a fork of it (the object IS the
 * original), a comment on it. Empty when the table is absent.
 */
export async function ownerFeed(userId: string, opts: { limit?: number } = {}): Promise<EventEnvelope[]> {
  if (!(await eventsTablePresent())) return [];
  const db = await getDb();
  // `at` alone is not a total order — a batch lands on one timestamp — so the
  // id breaks the tie and the page is stable.
  const r = await db.query<EventRow>(
    `SELECT e.* FROM ${EVENTS_SCHEMA}.events e
       JOIN artifacts a ON a.id = e.object_id
      WHERE a.user_id = $1 AND e.object_kind = 'artifact'
      ORDER BY e.at DESC, e.id DESC
      LIMIT $2`,
    [userId, opts.limit ?? FEED_DEFAULT_LIMIT],
  );
  return r.rows.map(envelopeOf);
}
