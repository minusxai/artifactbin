/**
 * THE WRITER, IN THIS PROCESS. The only entry that touches the database:
 * import `@artifactbin/events` for the contract, the client and the server
 * shell; import this only from a composition root (the single image's
 * server.ts hands it the app's own Db handle — never a second PGLite on the
 * same data directory; the lean image's server.ts hands it a pg Pool).
 */
import type { EventEnvelope, EventSink, EventsService, Queryable } from '@artifactbin/contracts';
import { ensureTable } from '@artifactbin/utils';
import { DEFAULT_EVENTS_SCHEMA, EVENTS_TABLE, EVENTS_TABLES } from './schema';

/** A schema name is INTERPOLATED into DDL — nothing but a plain identifier may reach it. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface EventsWriterOptions {
  db: Queryable;
  /** The schema this service owns; created when absent. Default `events`. */
  schema?: string;
  /** Where a STORED batch goes next. Empty here; a deployment fills it. A throwing sink is logged and never fails the write. */
  sinks?: EventSink[];
}

/**
 * Create the schema (when absent) and the table, idempotently — run on every
 * boot, like every other package's DDL. Refuses a schema name that is not a
 * plain identifier: it is interpolated into DDL.
 */
export async function ensureEventsSchema(db: Queryable, schema: string = DEFAULT_EVENTS_SCHEMA): Promise<void> {
  if (!IDENTIFIER.test(schema)) throw new Error(`ensureEventsSchema: schema ${JSON.stringify(schema)} is not a plain identifier`);
  const exists = (await db.query('SELECT 1 AS one FROM pg_namespace WHERE nspname = $1', [schema])).rows.length > 0;
  if (!exists) await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ensureTable(db, EVENTS_TABLES, { schema });
}

/** The row, as the wire orders it — one list, so the INSERT's columns and its parameters cannot drift. */
const COLUMNS = ['id', 'at', 'source', 'subject_kind', 'subject_id', 'verb', 'object_kind', 'object_id', 'payload'] as const;

/**
 * The service: `emit` ensures the schema once (memoised), inserts every
 * envelope `ON CONFLICT (id) DO NOTHING` in one statement per batch, then hands
 * the batch to each sink. It never rejects — a failed insert is one error
 * line, and a sink's rejection is another; the writer's caller sees neither.
 */
export function createEvents(opts: EventsWriterOptions): EventsService {
  const schema = opts.schema ?? DEFAULT_EVENTS_SCHEMA;
  const sinks = opts.sinks ?? [];
  // ONE ensure per service, not per batch: the DDL is idempotent but it is
  // still a round trip, and `emit` sits on the request path. A REJECTION is
  // forgotten, though — memoising it would leave a writer whose database was
  // merely slow to come up dead until the process restarts, and nothing in the
  // product would say so, because emit never rejects.
  let ensured: Promise<void> | null = null;
  const ready = (): Promise<void> => (ensured ??= ensureEventsSchema(opts.db, schema).catch((error) => {
    ensured = null;
    throw error;
  }));
  return {
    async emit(events: EventEnvelope[]): Promise<void> {
      if (events.length === 0) return;
      try {
        await ready();
        // ONE statement per batch: the placeholders are generated from the
        // column list above, and `payload` is cast because a JSON string
        // parameter is text until it is told otherwise.
        const rows = events.map((_, row) => `(${COLUMNS.map((c, col) => `$${row * COLUMNS.length + col + 1}${c === 'payload' ? '::jsonb' : ''}`).join(', ')})`);
        const params = events.flatMap((e) => [e.id, e.at, e.source, e.subject_kind, e.subject_id, e.verb, e.object_kind, e.object_id, JSON.stringify(e.payload ?? {})]);
        await opts.db.query(
          `INSERT INTO ${schema}.${EVENTS_TABLE.name} (${COLUMNS.join(', ')}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO NOTHING`,
          params,
        );
      } catch (error) {
        // Telemetry never fails the product: the caller is told nothing, the
        // operator is told everything. The sinks do not run — they forward a
        // STORED batch.
        console.error('[events] storing %d events failed:', events.length, error);
        return;
      }
      for (const sink of sinks) {
        // Per sink, so a throwing one cannot swallow the ones after it.
        try { await sink(events); } catch (error) { console.error('[events] a sink refused %d events:', events.length, error); }
      }
    },
  };
}

export { backfillSql, backfillAnalyticsEvents, type BackfillOptions } from './backfill';
