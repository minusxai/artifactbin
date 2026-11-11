/**
 * THE PUBLIC EVENTS FEED: `GET /api/events` (CONTRACT §6, the wire in contracts/event-feed). It reads the events
 * service's log with SELECT (the app holds nothing more on that schema) and joins the app's own tables to decide,
 * on every poll, what the caller may observe now:
 * - an artifact event: the artifact is live and in `commentMonitorScope` (owner, share, link or group reach), the
 *   scope the comment feed always used, so whoever may read a page's comments sees its comment events.
 * Another object kind joins the feed with its own category (contracts EVENT_CATEGORIES) and its own access rule here.
 *
 * Positions are assigned by the events service at durable acceptance (services/events local.ts), in commit order, so
 * a scan's last position is a safe resume point: anything committed later has a higher one. A scan reads at most
 * SCAN_ROWS matching rows, filters them by access, and resumes after the last row it READ, so a page of rows the
 * caller may not see still advances. Each read first publishes this process's outbox (lib/platform), so a caller
 * sees its own committed writes at once; a wait re-checks the head every second.
 *
 * The stored `via` (the writing credential and agent session) only decides `actor.you` and is never served.
 */
import { createHash } from 'node:crypto';
import {
  EVENT_CATEGORIES, EVENT_FEED_DEFAULT_LIMIT, EVENT_FEED_MAX_LIMIT, EVENT_FEED_MAX_WAIT_SECONDS, EVENT_FEED_RETENTION_DAYS,
  EVENT_FEED_SCHEMA_VERSION, EVENT_FEED_TYPES, type EventFeedEvent, type EventFeedPage, type EventFeedType, type EventOrigin,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { commentMonitorScope } from '@/lib/artifact-access';
import { EVENTS_SCHEMA, getDb, publishEventOutbox } from '@/lib/platform';

if (!/^[a-z_][a-z0-9_]*$/.test(EVENTS_SCHEMA)) throw new Error(`EVENTS__SCHEMA is not an identifier: ${EVENTS_SCHEMA}`);

/** A refusal the route turns into `{ error: { code } }` with this status. */
export class EventFeedRefusal extends Error {
  constructor(readonly code: string, readonly status: number, message = code) { super(message); }
}

/** What one request asks for, already validated. */
export interface EventFeedQuery {
  artifactId: string | null;
  types: readonly EventFeedType[];
  /** null: from the start of the retained feed; 'now': from the head; else a cursor or a bare position. */
  after: string | null;
  waitSeconds: number;
  limit: number;
}

/** The query string, validated against the contract's caps and catalogue. Throws EventFeedRefusal (400). */
export function parseEventFeedQuery(query: URLSearchParams): EventFeedQuery {
  const number = (name: string, fallback: number, min: number, max: number) => {
    const raw = query.get(name);
    if (raw === null) return fallback;
    if (!/^\d{1,4}$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new EventFeedRefusal(`invalid_${name}`, 400);
    return Number(raw);
  };
  const artifactId = query.get('artifact_id');
  if (artifactId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(artifactId)) throw new EventFeedRefusal('invalid_artifact_id', 400);
  const category = query.get('category');
  if (category !== null && !Object.hasOwn(EVENT_CATEGORIES, category)) throw new EventFeedRefusal('invalid_category', 400);
  const listed = query.get('types')?.split(',').map(type => type.trim()).filter(Boolean) ?? [];
  if (listed.some(type => !(EVENT_FEED_TYPES as readonly string[]).includes(type))) throw new EventFeedRefusal('invalid_types', 400);
  // Both filters narrow: a type must be in the category AND the list when both are given.
  const inCategory = category ? EVENT_CATEGORIES[category as keyof typeof EVENT_CATEGORIES] as readonly string[] : null;
  const types = EVENT_FEED_TYPES.filter(type => (!inCategory || inCategory.includes(type)) && (!listed.length || listed.includes(type)));
  if (!types.length) throw new EventFeedRefusal('invalid_types', 400, 'No event type matches both category and types');
  return {
    artifactId, types, after: query.get('after'),
    waitSeconds: number('wait', 0, 0, EVENT_FEED_MAX_WAIT_SECONDS),
    limit: number('limit', EVENT_FEED_DEFAULT_LIMIT, 1, EVENT_FEED_MAX_LIMIT),
  };
}

// Concurrency leases, as the comment feed had: per account and per process, released when the wait ends.
const MAX_ACCOUNT_WAITS = 4;
const MAX_PROCESS_WAITS = 128;
const accountWaits = new Map<string, number>();
let activeWaits = 0;
function acquireWait(actor: AccessActor): () => void {
  const key = actor.userId ? `account:${actor.userId}` : `token:${actor.tokenId}`;
  const count = accountWaits.get(key) ?? 0;
  // No await between checking and reserving: concurrent requests cannot overbook.
  if (count >= MAX_ACCOUNT_WAITS || activeWaits >= MAX_PROCESS_WAITS) throw new EventFeedRefusal('too_many_event_waits', 429);
  accountWaits.set(key, count + 1);
  activeWaits++;
  return () => {
    const remaining = accountWaits.get(key)! - 1;
    if (remaining) accountWaits.set(key, remaining);
    else accountWaits.delete(key);
    activeWaits--;
  };
}

/** Matching rows one scan reads; a request scans at most SCANS times before answering without waiting. */
const SCAN_ROWS = 1000;
const SCANS = 10;
/** A wait looks for a new head this often, and re-checks a filtered artifact's access every ACCESS_TICKS looks. */
const TICK_MS = 1000;
const ACCESS_TICKS = 5;
const RETENTION = `interval '${EVENT_FEED_RETENTION_DAYS} days'`;
const EVENTS = `${EVENTS_SCHEMA}.events`;

/** A cursor is bound to the caller and the filter: `{v, s: scope, p: position}`, base64url JSON. */
const scopeOf = (actor: AccessActor, query: EventFeedQuery) => createHash('sha256')
  .update(JSON.stringify([actor.userId ?? actor.tokenId, query.artifactId, [...query.types].sort()])).digest('hex').slice(0, 32);
const encode = (scope: string, position: bigint) => Buffer.from(JSON.stringify({ v: 1, s: scope, p: String(position) })).toString('base64url');
const POSITION = /^(0|[1-9]\d{0,17})$/;
function decode(raw: string, scope: string): bigint {
  if (POSITION.test(raw)) return BigInt(raw);
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { v?: unknown; s?: unknown; p?: unknown };
    if (cursor.v !== 1 || cursor.s !== scope || typeof cursor.p !== 'string' || !POSITION.test(cursor.p)) throw new Error();
    return BigInt(cursor.p);
  } catch { throw new EventFeedRefusal('invalid_cursor', 400); }
}

interface Row {
  id: string; position: string; at: string | Date; subject_kind: string | null; subject_id: string | null;
  verb: string; object_kind: string; object_id: string; payload: Record<string, unknown>; visible: boolean;
}

/** `you`: made with the credential reading the feed and, when both name one, the same agent session. */
function isYou(actor: AccessActor, session: string | null, row: Row, via: EventOrigin | undefined): boolean {
  if (!via) return !!actor.tokenId && row.subject_kind === 'token' && row.subject_id === actor.tokenId;
  if (!actor.tokenId) return via.token_id === null && row.subject_kind === 'user' && row.subject_id === actor.userId;
  return via.token_id === actor.tokenId && (!session || !via.session || via.session === session);
}

function toWire(row: Row, actor: AccessActor, session: string | null): EventFeedEvent {
  const { via, ...payload } = row.payload as { via?: EventOrigin } & Record<string, unknown>;
  const kind = row.subject_kind;
  return {
    id: row.id, position: Number(row.position), type: `${row.object_kind}.${row.verb}` as EventFeedType,
    at: new Date(row.at).toISOString(), schema_version: EVENT_FEED_SCHEMA_VERSION,
    resource: { kind: 'artifact', id: row.object_id },
    actor: row.subject_id && (kind === 'user' || kind === 'token')
      ? { kind, id: row.subject_id, you: isYou(actor, session, row, via) } : null,
    payload,
  };
}

const tableSeen = new WeakSet<object>();
async function feedPresent(): Promise<boolean> {
  const db = await getDb();
  if (tableSeen.has(db)) return true;
  const present = (await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [EVENTS])).rows[0]?.present === true;
  if (present) tableSeen.add(db);
  return present;
}

/**
 * One page of the feed for this caller, or null when `artifactId` names an artifact the caller may not observe.
 * Throws EventFeedRefusal: invalid_cursor (400), cursor_expired (410), too_many_event_waits (429).
 */
export async function readEventsFor(actor: AccessActor, query: EventFeedQuery, options: {
  signal: AbortSignal;
  /** The reading agent's session (`Artifactbin-Session`), when it named one. */
  session?: string | null;
}): Promise<EventFeedPage | null> {
  const db = await getDb();
  const signal = options.signal, session = options.session ?? null;
  const scope = scopeOf(actor, query), monitor = commentMonitorScope(actor);
  const authorized = async () => !query.artifactId ||
    (await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${monitor.where('$2')}`, [query.artifactId, monitor.val])).rows.length > 0;
  signal.throwIfAborted();
  if (!await authorized()) return null;
  // Publish first: on a database whose events table does not exist yet, the first publish creates it.
  await publishEventOutbox(db);
  if (!await feedPresent()) return { events: [], next: encode(scope, 0n) };
  const head = async () => BigInt((await db.query<{ p: string }>(`SELECT coalesce(max(position), 0)::text AS p FROM ${EVENTS}`)).rows[0]!.p);
  let position: bigint;
  if (query.after === 'now') position = await head();
  else if (query.after === null) {
    // The start of what is retained: just before the earliest event accepted inside the window.
    const first = (await db.query<{ p: string }>(`SELECT position::text AS p FROM ${EVENTS} WHERE position IS NOT NULL
      AND accepted_at >= now() - ${RETENTION} ORDER BY accepted_at, position LIMIT 1`)).rows[0];
    position = first ? BigInt(first.p) - 1n : await head();
  } else {
    position = decode(query.after, scope);
    // Expired: the next event was accepted before the window (events were dropped from view), or the cursor is past
    // the head (another installation's, or a database rebuilt beneath it). Either way: resynchronize.
    const next = (await db.query<{ old: boolean }>(`SELECT accepted_at < now() - ${RETENTION} AS old FROM ${EVENTS}
      WHERE position > $1::bigint ORDER BY position LIMIT 1`, [String(position)])).rows[0];
    if (next?.old || (!next && position > await head())) throw new EventFeedRefusal('cursor_expired', 410);
  }

  const byKind = (kind: string) => query.types.filter(type => type.startsWith(`${kind}.`)).map(type => type.slice(kind.length + 1));
  const scan = async (): Promise<{ events: EventFeedEvent[]; full: boolean } | null> => {
    signal.throwIfAborted();
    const result = await db.query<Row>(`WITH raw AS (
        SELECT id, position, at, subject_kind, subject_id, verb, object_kind, object_id, payload FROM ${EVENTS}
        WHERE position > $1::bigint AND object_kind = 'artifact' AND verb = ANY($2::text[])
          ${query.artifactId ? `AND object_id = $4` : ''}
        ORDER BY position LIMIT ${SCAN_ROWS}
      ) SELECT raw.id, raw.position::text AS position, raw.at, raw.subject_kind, raw.subject_id, raw.verb, raw.object_kind,
        raw.object_id, raw.payload,
        EXISTS (SELECT 1 FROM artifacts WHERE artifacts.id = raw.object_id AND ${monitor.where('$3')}) AS visible
      FROM raw ORDER BY raw.position`,
      [String(position), byKind('artifact'), monitor.val, ...(query.artifactId ? [query.artifactId] : [])]);
    const visible = result.rows.filter(row => row.visible).slice(0, query.limit);
    // Resume after the last row returned when the page filled, else after the last row read.
    const last = visible.length === query.limit ? visible.at(-1) : result.rows.at(-1);
    if (last) position = BigInt(last.position);
    signal.throwIfAborted();
    if (!await authorized()) return null;
    return { events: visible.map(row => toWire(row, actor, session)), full: result.rows.length === SCAN_ROWS || visible.length === query.limit };
  };
  const page = (events: EventFeedEvent[]): EventFeedPage => ({ events, next: encode(scope, position) });

  for (let scans = 0; scans < SCANS; scans++) {
    const result = await scan();
    if (!result) return null;
    if (result.events.length) return page(result.events);
    if (!result.full) break;
    if (scans === SCANS - 1) return page([]);
  }
  if (!query.waitSeconds) return page([]);
  const release = acquireWait(actor);
  try {
    const deadline = Date.now() + query.waitSeconds * 1000;
    for (let tick = 1; Date.now() < deadline; tick++) {
      await sleep(Math.min(TICK_MS, Math.max(0, deadline - Date.now())), signal);
      await publishEventOutbox(db);
      if (await head() > position) {
        const result = await scan();
        if (!result) return null;
        if (result.events.length) return page(result.events);
      } else if (tick % ACCESS_TICKS === 0 && !await authorized()) return null;
    }
    return page([]);
  } finally { release(); }
}

/** Resolves after `ms`; rejects with the abort reason. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
