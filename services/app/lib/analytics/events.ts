/**
 * Usage telemetry writes only the canonical events log. Retired analytics_events rows stay stored;
 * no implicit migration is performed. trackEvent never rejects. Call after the caller's transaction
 * commits: an events service can share PGLite's serialized connection.
 * Views use a daily salted visitor hash, including the account when signed in. Raw IP/UA never leave
 * request scope. Without request identity each envelope counts separately. sse_connect has no log verb.
 */
import { createHash } from 'crypto';
import type { EventEnvelope, EventVerb } from '@artifactbin/contracts';
import { forwardedFor, identifyClient } from '../accounts';
import { ANALYTICS_SECRET, TRUSTED_PROXY_HOPS, currentHeaders, emit, envelope, services, type EventSubject } from '../platform';

type AnalyticsEvent =
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
 * anyone reads back, so it produces no telemetry.
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
  opts: { userId?: string | null; forkId?: string | null; parentId?: string | null; format?: string; subtree?: number } = {},
): Promise<void> {
  const {client,visitor}=await analyticsIdentity(opts.userId);
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
    // A delete says what went with it: a folder takes its subtree, and the
    // count is the difference between losing a document and losing a shelf.
    else if (verb === 'deleted') await emit(subject, verb, object, { ...payload, ...(opts.format !== undefined ? { format: opts.format } : {}), ...(opts.subtree !== undefined ? { subtree: opts.subtree } : {}) });
    else await emit(subject, verb, object, payload);
  } catch {
    // trackEvent never rejects, whatever the mapping or the service did.
  }
}

/**
 * A SERVED VIEW, batched: the document frame's view is the one write every render made (a log
 * sentence), so views are buffered and written together — one log append — every
 * few seconds, or sooner when the buffer fills, and on shutdown (lib/runtime/app-background-tasks).
 *
 * Each view keeps its own row and sentence: the visitor, client and moment are taken NOW, in the request's scope,
 * and only the write is deferred. Never rejects; the returned promise settles when this view's batch is written.
 */
const VIEW_FLUSH_MS = 2_000;
const VIEW_BATCH_MAX = 500;
interface PendingView { sentence: EventEnvelope }
let pendingViews: PendingView[] = [];
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let viewBatch: { promise: Promise<void>; resolve: () => void } | undefined;
export async function recordView(artifactId: string, opts: { userId?: string | null } = {}): Promise<void> {
  const { client, visitor } = await analyticsIdentity(opts.userId);
  const userId = opts.userId ?? null;
  // A VIEW's subject is ALWAYS the daily visitor hash (see trackEvent); the sentence is stamped now, at the view.
  const sentence = envelope(visitor ? { kind: 'visitor', id: visitor } : null, 'viewed', { kind: 'artifact', id: artifactId }, { client, user_id: userId });
  pendingViews.push({ sentence });
  let resolve!: () => void;
  const batch = viewBatch ??= { promise: new Promise<void>(r => { resolve = r; }), resolve: () => resolve() };
  if (pendingViews.length >= VIEW_BATCH_MAX) void flushViews();
  else if (!viewTimer) {
    viewTimer = setTimeout(() => void flushViews(), VIEW_FLUSH_MS);
    viewTimer.unref?.();
  }
  return batch.promise;
}

/** Write every buffered view now. Never rejects; resolves once they are written (or failed quietly). */
export async function flushViews(): Promise<void> {
  if (viewTimer) clearTimeout(viewTimer);
  viewTimer = undefined;
  const views = pendingViews, batch = viewBatch;
  pendingViews = [];
  viewBatch = undefined;
  if (!views.length) { batch?.resolve(); return; }
  try {
    await services().events.emit(views.map(v => v.sentence));
  } catch (error) {
    console.error('[events] emit failed:', error);
  }
  batch?.resolve();
}

/** Request metadata only: no database access. */
async function analyticsIdentity(userId?:string|null):Promise<{client:string|null;visitor:string|null}>{
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
    // the hop the nearest TRUSTED proxy appended (lib/accounts/client-identity
    // forwardedFor) — reading the caller-supplied head instead would let a
    // header split one visitor into unlimited distinct ones.
    const ip = forwardedFor(h, TRUSTED_PROXY_HOPS);
    if (ip || ua) {
      const day = new Date().toISOString().slice(0, 10);
      visitor = createHash('sha256')
        .update(`${day}:${ip}:${ua ?? ''}:${userId ?? ''}:${ANALYTICS_SECRET}`)
        .digest('hex')
        .slice(0, 32);
    }
  } catch {
    // Outside a request scope (tests, detached work) — no UA to read.
  }
  return {client,visitor};
}
