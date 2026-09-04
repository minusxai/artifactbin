/**
 * THE WRITER, IN THIS PROCESS. The only entry that touches the database:
 * import `@artifactbin/events` for the contract, the client and the server
 * shell; import this only from a composition root (the single image's
 * server.ts hands it the app's own Db handle — never a second PGLite on the
 * same data directory; the lean image's server.ts hands it a pg Pool).
 */
import type { EventSink, EventsService, Queryable } from '@artifactbin/contracts';
import { DEFAULT_EVENTS_SCHEMA, EVENTS_TABLES } from './schema';

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
  void db; void schema; void EVENTS_TABLES;
  throw new Error('events-svc: implement ensureEventsSchema');
}

/**
 * The service: `emit` ensures the schema once (memoised), inserts every
 * envelope `ON CONFLICT (id) DO NOTHING` in one statement per batch, then hands
 * the batch to each sink. It never rejects — a failed insert is one error
 * line, and a sink's rejection is another; the writer's caller sees neither.
 */
export function createEvents(opts: EventsWriterOptions): EventsService {
  void opts;
  throw new Error('events-svc: implement createEvents');
}
