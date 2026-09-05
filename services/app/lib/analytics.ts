/**
 * Fire-and-forget usage analytics — the only module that WRITES
 * `analytics_events`, and, since the log arrived, only a writer: the dashboard
 * reads its view counts out of `lib/feed` (the events log, with this table as
 * the fallback while it still exists).
 *
 * The contract that matters: `trackEvent` NEVER rejects and never throws. It
 * is called as `void trackEvent(...)` from request paths, and an unhandled
 * rejection would kill the process (there is no global handler on purpose).
 * The other rule is placement: never call it from INSIDE a `db.transaction`
 * callback — on PGLite the transaction holds the serialized op queue, so an
 * unawaited query enqueued behind it deadlocks. Fire after the txn resolves.
 *
 * The `client` column is the harness guess from lib/client-identity, derived
 * from the request's User-Agent via the request context — so lib callers need
 * no signature change to carry it. Outside a request scope (tests calling
 * helpers directly) the column stays NULL.
 * MCP callers are stateless per request, so they are identified by UA only —
 * Claude Code's bare `node` UA lands as 'script'. Telemetry only: nothing may
 * ever gate on this value.
 *
 * The `visitor` column is a daily-rotating fingerprint —
 * sha256(day:ip:ua:ANALYTICS_SECRET) — its OWN secret (ANALYTICS__SECRET, falling back to the auth secret), so rotating auth never rewrites every "views" number — and every "views" number counted off
 * this column (lib/users' per-artifact totals, lib/feed's daily series) is
 * COUNT(DISTINCT visitor): unique people per day, so a refresh
 * never inflates a count. No raw IP or UA is ever stored, the embedded day
 * kills cross-day identity, and legacy NULL-visitor rows coalesce to their
 * own seq — their own row id once copied into the log (each counts once, undedupable). Known trade: one office NAT +
 * one browser build = one visitor that day.
 */
import { createHash } from 'crypto';
import { currentHeaders } from './request-context';
import type { EventVerb } from '@artifactbin/contracts';
import { forwardedFor, identifyClient } from '@/lib/client-identity';
import { ANALYTICS_SECRET, TRUSTED_PROXY_HOPS } from '@/lib/config';
import { getDb } from '@/lib/db';
import { emit, type EventSubject } from '@/lib/events';

export type AnalyticsEvent =
  | 'view'
  | 'export'
  | 'sse_connect'
  | 'create'
  | 'update'
  | 'edit'
  /** A reader wrote rows to a dataset through a document's <Mutation>. */
  | 'mutate'
  | 'revert'
  /** Someone took a copy of this artifact — recorded against the ORIGINAL. */
  | 'fork'
  | 'delete';

/**
 * The same moment, said in the log's words. `sse_connect` is not a moment
 * anyone reads back, so it stays a row and never becomes a sentence.
 */
const EVENT_VERBS_BY_ANALYTICS = {
  view: 'viewed',
  export: 'exported',
  create: 'created',
  update: 'updated',
  edit: 'edited',
  mutate: 'mutated',
  revert: 'reverted',
  fork: 'forked',
  delete: 'deleted',
  sse_connect: null,
} as const satisfies Record<AnalyticsEvent, EventVerb<'artifact'> | null>;

/** Fire-and-forget: never rejects. Callers write `void trackEvent(...)`; tests may await it. */
export async function trackEvent(
  event: AnalyticsEvent,
  artifactId: string,
  opts: { userId?: string | null; forkId?: string | null; parentId?: string | null } = {},
): Promise<void> {
  let client: string | null = null;
  let visitor: string | null = null;
  try {
    const h = await currentHeaders();
    if (!h) throw new Error('off-request');
    const ua = h.get('user-agent');
    client = identifyClient({ userAgent: ua }).harness;
    // The visitor key: a DAILY-ROTATING salted hash, never the raw IP or UA
    // (Plausible-style). Same person, same day → same key, so a refresh is
    // not a new view; the embedded day means no cross-day identity exists,
    // and the secret keeps the tiny IPv4 space from being brute-forced back
    // out of the hash. The user id joins the hash when present, so two
    // accounts behind one NAT + browser still count as two people. The IP is
    // the hop the nearest TRUSTED proxy appended (lib/client-identity
    // forwardedFor) — reading the caller-supplied head instead would let a
    // header split one visitor into unlimited distinct ones.
    const ip = forwardedFor(h, TRUSTED_PROXY_HOPS);
    if (ip || ua) {
      const day = new Date().toISOString().slice(0, 10);
      visitor = createHash('sha256')
        .update(`${day}:${ip}:${ua ?? ''}:${opts.userId ?? ''}:${ANALYTICS_SECRET}`)
        .digest('hex')
        .slice(0, 32);
    }
  } catch {
    // Outside a Next request scope (tests, detached work) — no UA to read.
  }
  try {
    const db = await getDb();
    await db.query('INSERT INTO analytics_events (event, artifact_id, user_id, client, visitor) VALUES ($1, $2, $3, $4, $5)', [
      event,
      artifactId,
      opts.userId ?? null,
      client,
      visitor,
    ]);
  } catch {
    // Analytics must never take a request down with it.
  }
  // The counter row and the sentence are INDEPENDENT telemetry, dual-written
  // for one release: neither one failing may stop the other, and `emit` itself
  // never rejects.
  try {
    const verb = EVENT_VERBS_BY_ANALYTICS[event];
    if (!verb) return;
    const visitorSubject: EventSubject | null = visitor ? { kind: 'visitor', id: visitor } : null;
    // A VIEW's subject is ALWAYS the daily visitor hash, signed in or not —
    // the view counts dedupe on it, and the account rides in the payload.
    const subject: EventSubject | null =
      verb === 'viewed' ? visitorSubject : opts.userId ? { kind: 'user', id: opts.userId } : visitorSubject;
    const object = { kind: 'artifact', id: artifactId } as const;
    const payload = { client, user_id: opts.userId ?? null };
    // The fork is recorded against the ORIGINAL; the copy is the payload.
    if (verb === 'forked') await emit(subject, verb, object, { ...payload, fork_id: opts.forkId ?? null });
    // A create says WHERE, so a folder create and a filed create read as
    // themselves rather than as one anonymous `created` a reader must join
    // the artifacts table to place. Null is the root, which is most creates.
    else if (verb === 'created') await emit(subject, verb, object, { ...payload, parent_id: opts.parentId ?? null });
    else await emit(subject, verb, object, payload);
  } catch {
    // trackEvent never rejects, whatever the mapping or the service did.
  }
}
