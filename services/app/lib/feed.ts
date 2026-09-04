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

export const FEED_DEFAULT_LIMIT = 50;

/** Is there an events table to read? Cheap (`to_regclass`), asked per read; false is a documented state, not a fault. */
export async function eventsTablePresent(): Promise<boolean> {
  throw new Error('events-app: implement eventsTablePresent');
}

/**
 * "What happened to what I own": every event whose object is one of the
 * user's artifacts, newest first — a view, a fork of it (the object IS the
 * original), a comment on it. Empty when the table is absent.
 */
export async function ownerFeed(userId: string, opts: { limit?: number } = {}): Promise<EventEnvelope[]> {
  void userId; void opts; void FEED_DEFAULT_LIMIT;
  throw new Error('events-app: implement ownerFeed');
}
