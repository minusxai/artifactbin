/**
 * THE WRITER, IN THIS PROCESS. The only entry that touches the database:
 * import `@artifactbin/events` for the contract, the client and the server
 * shell; import this only from a composition root (the single image's
 * server.ts hands it the app's own Db handle — never a second PGLite on the
 * same data directory; the lean image's server.ts hands it a pg Pool).
 */
import { randomUUID } from 'node:crypto';
import type { EventEnvelope, EventSink, EventSubscriber, EventsService, Queryable } from '@artifactbin/contracts';
import { ensureTable } from '@artifactbin/utils';
import { DEFAULT_EVENTS_SCHEMA, EVENTS_TABLES, IDENTIFIER } from './schema';

interface EventsWriterOptions {
  db: Queryable;
  /** The schema this service owns; created when absent. Default `events`. */
  schema?: string;
  /** Where a STORED batch goes next. Empty here; a deployment fills it. A throwing sink is logged and never fails the write. */
  sinks?: EventSink[];
  subscribers?: EventSubscriber[];
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
  // The counter starts at the highest stored position, so a database whose head row was lost never reuses one.
  await db.query(`INSERT INTO ${schema}.feed_head (id, position) SELECT 1, coalesce(max(position), 0) FROM ${schema}.events
    ON CONFLICT (id) DO NOTHING`);
  // Rows stored before positions existed get them in emitter order, through the same counter row as every append.
  await db.query(`WITH todo AS (
      SELECT id, row_number() OVER (ORDER BY at, id) AS n FROM ${schema}.events WHERE position IS NULL
    ), head AS (
      UPDATE ${schema}.feed_head SET position = position + (SELECT count(*) FROM todo)
      WHERE id = 1 AND EXISTS (SELECT 1 FROM todo) RETURNING position
    ) UPDATE ${schema}.events e SET position = head.position - (SELECT count(*) FROM todo) + todo.n
    FROM todo, head WHERE e.id = todo.id`);
}

/** The row, as the wire orders it — one list, so the INSERT's columns and its parameters cannot drift. */
const COLUMNS = ['id', 'at', 'source', 'subject_kind', 'subject_id', 'verb', 'object_kind', 'object_id', 'payload'] as const;
/** A VALUES list types its parameters itself: the two columns that are not text say what they are. */
const CASTS: Partial<Record<(typeof COLUMNS)[number], string>> = { at: '::timestamptz', payload: '::jsonb' };

/**
 * The service: `emit` ensures the schema once (memoised), inserts every
 * envelope `ON CONFLICT (id) DO NOTHING` in one statement per batch, then hands
 * the batch to each sink. It never rejects — a failed insert is one error
 * line, and a sink's rejection is another; the writer's caller sees neither.
 */
interface EventsWriter extends EventsService {
  publish(events: EventEnvelope[]): Promise<void>;
  drain(): Promise<void>;
}
export function createEvents(opts: EventsWriterOptions): EventsWriter {
  const schema = opts.schema ?? DEFAULT_EVENTS_SCHEMA;
  if (!IDENTIFIER.test(schema)) throw new Error('Invalid events schema');
  const subscribers = opts.subscribers ?? [];
  if (new Set(subscribers.map(s => s.id)).size !== subscribers.length || subscribers.some(s => !s.id)) throw new Error('Subscriber IDs must be unique and nonempty');
  let ensured: Promise<void> | null = null;
  const ready = () => ensured ??= ensureEventsSchema(opts.db, schema).catch(error => { ensured = null; throw error; });
  const publish = async (events: EventEnvelope[]) => {
    if (!events.length) return;
    await ready();
    const width = COLUMNS.length;
    const rows = events.map((_, row) => `(${COLUMNS.map((c, col) => `$${row * width + col + 1}${CASTS[c] ?? ''}`).join(', ')}, ${row + 1})`);
    const params: unknown[] = events.flatMap(e => [e.id,e.at,e.source,e.subject_kind,e.subject_id,e.verb,e.object_kind,e.object_id,JSON.stringify(e.payload ?? {})]);
    params.push(subscribers.map(s => s.id), events.length);
    const [subscriberParam, countParam] = [params.length - 1, params.length];
    // ONE statement: the counter row first (its lock queues concurrent appends until this one commits), then the log
    // and its delivery receipts. Positions come from the head's committed value, so they ascend in commit order.
    const stored = await opts.db.query<EventEnvelope>(`WITH head AS (
      INSERT INTO ${schema}.feed_head AS h (id, position) VALUES (1, $${countParam}::bigint)
      ON CONFLICT (id) DO UPDATE SET position = h.position + EXCLUDED.position RETURNING position
    ), batch (${COLUMNS.join(', ')}, n) AS (VALUES ${rows.join(', ')}), inserted AS (
      INSERT INTO ${schema}.events (${COLUMNS.join(', ')}, position, accepted_at)
      SELECT ${COLUMNS.map(c => `b.${c}`).join(', ')}, head.position - $${countParam}::bigint + b.n, clock_timestamp()
      FROM batch b CROSS JOIN head ORDER BY b.n
      ON CONFLICT (id) DO NOTHING RETURNING ${COLUMNS.join(', ')}
    ), queued AS (
      INSERT INTO ${schema}.deliveries(event_id,subscriber)
      SELECT i.id,s FROM inserted i CROSS JOIN unnest($${subscriberParam}::text[]) s ON CONFLICT DO NOTHING
    ) SELECT * FROM inserted`, params);
    for (const sink of opts.sinks ?? []) {
      if (!stored.rows.length) break;
      try { await sink(stored.rows); } catch (error) { console.error('[events] legacy sink failed:',error); }
    }
  };
  let draining: Promise<void> | null = null;
  const drain = async () => {
    await ready();
    for (const subscriber of subscribers) {
      const claim = randomUUID();
      const batch = await opts.db.query<EventEnvelope>(`WITH picked AS (
        SELECT event_id,subscriber FROM ${schema}.deliveries WHERE subscriber=$1 AND delivered_at IS NULL AND available_at<=now()
        ORDER BY available_at,event_id LIMIT 50 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE ${schema}.deliveries d SET claim=$2,attempts=attempts+1,available_at=now()+interval '60 seconds'
        FROM picked p WHERE d.event_id=p.event_id AND d.subscriber=p.subscriber RETURNING d.event_id
      ) SELECT ${COLUMNS.map(c=>`e.${c}`).join(',')} FROM ${schema}.events e JOIN claimed c ON c.event_id=e.id ORDER BY e.position NULLS LAST,e.at,e.id`,[subscriber.id,claim]);
      if (!batch.rows.length) continue;
      const renew=setInterval(()=>{void opts.db.query(`UPDATE ${schema}.deliveries SET available_at=now()+interval '60 seconds' WHERE subscriber=$1 AND claim=$2`,[subscriber.id,claim]).catch(()=>{});},20000);
      renew.unref();
      try { for(const event of batch.rows){
        try {
          await subscriber.deliver([event]);
          await opts.db.query(`UPDATE ${schema}.deliveries SET delivered_at=now(),claim=NULL WHERE subscriber=$1 AND claim=$2 AND event_id=$3`,[subscriber.id,claim,event.id]);
        } catch {
          await opts.db.query(`UPDATE ${schema}.deliveries SET claim=NULL,available_at=now()+least(3600,power(2,least(attempts,12))) * interval '1 second' WHERE subscriber=$1 AND claim=$2 AND event_id=$3`,[subscriber.id,claim,event.id]);
        }
      }}finally{clearInterval(renew);}
    }
  };
  return {
    publish,
    async emit(events) { try { await publish(events); } catch(error) { console.error('[events] storage failed:',error); } },
    drain() { return draining ??= drain().finally(() => { draining = null; }); },
  };
}

