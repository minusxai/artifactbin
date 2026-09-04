/**
 * THE LEGACY VIEW COUNTER, COPIED INTO THE LOG — once. `analytics_events`
 * (the app's fire-and-forget usage rows) becomes `<schema>.events` in one
 * idempotent statement: every row keeps its identity (`legacy:<seq>`), its
 * time, its visitor hash (NULL stays NULL — such a row counts once, exactly as
 * the old dedupe treated it) and its user/client in the payload; `sse_connect`
 * rows are not moments anyone reads back and are not copied.
 *
 * Who runs it: the single image's composition root, on every boot, right after
 * it registers the writer (ON CONFLICT makes the second run free); a split
 * deployment's operator, ONCE, as the database owner — the events role has no
 * read on the app schema, on purpose, so the statement is exported as text.
 */
import type { Queryable } from '@artifactbin/contracts';

export interface BackfillOptions {
  /** The schema the events service owns. */
  schema: string;
  /** The legacy table as THIS connection sees it: `analytics_events` in the single image, a qualified name for an operator. */
  from: string;
}

/** The one statement, as text — what an operator pastes, and what `backfillAnalyticsEvents` runs. */
export function backfillSql(opts: BackfillOptions): string {
  void opts;
  throw new Error('events-views: implement backfillSql');
}

/** Run it; resolves to the number of rows copied (0 on every run after the first). Refuses a non-identifier schema or table name. */
export async function backfillAnalyticsEvents(db: Queryable, opts: BackfillOptions): Promise<number> {
  void db; void opts;
  throw new Error('events-views: implement backfillAnalyticsEvents');
}
