/** Shared presence probe for canonical log readers. No service means empty analytics, never legacy fallback. */
import { EVENTS_SCHEMA, getDb } from '../platform';

/**
 * The schema name is interpolated (a parameter cannot name a schema), so it is
 * validated ONCE, at import, against the identifier grammar — the same shape
 * the proxy demands of `APP__SCHEMA`. A deployment with a bad name fails to
 * boot rather than reaching a query builder with it.
 */
if (!/^[a-z_][a-z0-9_]*$/.test(EVENTS_SCHEMA)) {
  throw new Error(`EVENTS__SCHEMA is not an identifier: ${EVENTS_SCHEMA}`);
}

/**
 * Databases on which the events table has been seen. The table is created by the events service's boot DDL and
 * never dropped, so a positive answer holds for the life of the database handle and is asked once; the negative
 * answer is a documented state that a later boot can end, so it is asked again every time. Keyed by handle,
 * not module state: a handle that is closed and reopened (tests, a reconnect to another database) is asked afresh.
 */
let eventsSeen = new WeakSet<object>();

/** Is there an events table to read? `to_regclass` once per database; false is a documented state, not a fault. */
export async function eventsTablePresent(): Promise<boolean> {
  const db = await getDb();
  if (eventsSeen.has(db)) return true;
  const r = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
  const present = r.rows[0]?.present === true;
  if (present) eventsSeen.add(db);
  return present;
}

/** Forget what was learned about the events table: for a test that drops the schema under a live handle. */
export function forgetEventsTable(): void {
  eventsSeen = new WeakSet();
}

