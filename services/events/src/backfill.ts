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
 *
 * THE VERB MAPPING IS SAID TWICE, and has to be: the app says it in TypeScript
 * (`EVENT_VERBS_BY_ANALYTICS` in services/app/lib/analytics.ts, which the
 * dual-write uses) and this file says it in SQL, because a service may not
 * import the app. Edit one and edit the other — the app's
 * `__tests__/feed-views.test.ts` is what notices when they disagree.
 */
import type { Queryable } from '@artifactbin/contracts';
import { IDENTIFIER } from './schema';

/** A qualified legacy name is at most `<schema>.<table>`: the identifier grammar, once per part. */
const PART = IDENTIFIER.source.replace(/^\^|\$$/g, '');
const QUALIFIED = new RegExp(`^${PART}(\\.${PART})?$`);

export interface BackfillOptions {
  /** The schema the events service owns. */
  schema: string;
  /** The legacy table as THIS connection sees it: `analytics_events` in the single image, a qualified name for an operator. */
  from: string;
}

/**
 * The old `event` column, said in the log's words. `sse_connect` is absent on
 * purpose: it is a connection, not a moment, and the WHERE below drops it
 * along with any other value this table does not know.
 */
const VERBS: Record<string, string> = {
  view: 'viewed',
  export: 'exported',
  create: 'created',
  update: 'updated',
  edit: 'edited',
  mutate: 'mutated',
  revert: 'reverted',
  fork: 'forked',
  delete: 'deleted',
};

/** The one statement, as text — what an operator pastes, and what `backfillAnalyticsEvents` runs. */
export function backfillSql(opts: BackfillOptions): string {
  // Both names are INTERPOLATED — nothing but the identifier grammar may reach
  // the statement, and the refusal happens before any of it is built.
  if (!IDENTIFIER.test(opts.schema)) throw new Error(`backfillSql: schema ${JSON.stringify(opts.schema)} is not a plain identifier`);
  if (!QUALIFIED.test(opts.from)) throw new Error(`backfillSql: source table ${JSON.stringify(opts.from)} is not a plain identifier`);
  const events = Object.keys(VERBS);
  // The CASE and the WHERE are generated from ONE table, so a value can never
  // be copied without a verb, or given a verb and left behind.
  const verb = `CASE event ${events.map((event) => `WHEN '${event}' THEN '${VERBS[event]}'`).join(' ')} END`;
  return `INSERT INTO ${opts.schema}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
SELECT 'legacy:' || seq, created_at, 'app',
       CASE WHEN visitor IS NULL THEN NULL ELSE 'visitor'::text END, visitor,
       ${verb},
       'artifact', artifact_id,
       jsonb_strip_nulls(jsonb_build_object('user_id', user_id, 'client', client))
  FROM ${opts.from}
 WHERE event IN (${events.map((event) => `'${event}'`).join(', ')})
 ON CONFLICT (id) DO NOTHING`;
}

/** Run it; resolves to the number of rows copied (0 on every run after the first). Refuses a non-identifier schema or table name. */
export async function backfillAnalyticsEvents(db: Queryable, opts: BackfillOptions): Promise<number> {
  // `RETURNING` is the only way to COUNT what an ON CONFLICT insert actually
  // took: a Queryable hands back rows, never a rowCount — and the statement an
  // operator pastes stays the plain INSERT above.
  const { rows } = await db.query<{ id: string }>(`${backfillSql(opts)} RETURNING id`);
  return rows.length;
}
