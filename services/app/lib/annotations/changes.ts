/** Committed comments, replies, edits and reactions, by people and agents alike. NOTIFY only wakes readers; bounded
 * SQL scans own replay. Authorship is data, never a filter: each event names its author or reactor, and `you` marks the
 * writes made with the credential this feed is read with (`author_token_id`, `change_token_id`, the reaction's
 * `token_id`), so a watcher skips its own writes itself.
 *
 * A row's feed position is its KEY: `seq`, or `change_seq` once it has been edited (both drawn from seq's sequence).
 * Both annotation INSERT paths and the edit path lock the artifact before allocating, through commit, so a visible
 * same-artifact high watermark cannot skip a later low-position commit.
 *
 * Per row, past the reader's position: created after it (seq > position) → the plain new-comment event with its
 * current words; created before it → an edit event. Several edits since one checkpoint are one event, the latest.
 * Resolve, reopen and delete are not events: they carry no words to answer, a reopen that needs attention arrives
 * with its reply, and a deleted row is exactly what the feed drops.
 *
 * A reaction change is a row of `comment_reaction_events`, positioned from the same sequence under the same artifact
 * lock (store `setCommentReactionFor`), so one scan reads both tables in position order and the page limit counts
 * both. The reaction rows of one page net out per account, comment and kind (`reactionChangeEvents`).
 */
import { createHash } from 'node:crypto';
import type { CommentChangesPage, CommentFeedEvent, CommentReactionKind } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { commentMonitorScope } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { subscribeToAnnotations, TooManyLiveChannels } from '@/lib/publish/realtime/live';
import { commentChangeEvent, reactionChangeEvents } from '@artifactbin/utils/comment-watch';

export class InvalidCommentCursor extends Error {}
export class CommentWaitCapacityError extends Error {}

/** A wait that hears nothing re-checks access this often. Revoking a share sends no annotation wakeup, so this
 * bounds how long a revoked monitor keeps its wait; every wake costs one statement, where a scan costs two. */
const ACCESS_RECHECK_MS = 5000;

// Concurrency leases, not historical request buckets: keys disappear when their
// last wait finishes, and the process cap bounds the registry to 128 keys.
// Each replica enforces its own caps; this is not a distributed account quota.
const MAX_ACCOUNT_WAITS = 4;
const MAX_PROCESS_WAITS = 128;
const accountWaits = new Map<string, number>();
let activeWaits = 0;
function acquireWait(actor: AccessActor): () => void {
  const key = actor.userId ? `account:${actor.userId}` : `token:${actor.tokenId}`;
  const count = accountWaits.get(key) ?? 0;
  // No await between checking and reserving: concurrent requests cannot overbook.
  if (count >= MAX_ACCOUNT_WAITS || activeWaits >= MAX_PROCESS_WAITS) throw new CommentWaitCapacityError();
  accountWaits.set(key, count + 1);
  activeWaits++;
  return () => {
    const remaining = accountWaits.get(key)! - 1;
    if (remaining) accountWaits.set(key, remaining);
    else accountWaits.delete(key);
    activeWaits--;
  };
}
interface Cursor { v: 1; scope: string; seq: string }
interface ChangeRow {
  /** Which table the row is from; a reaction row's `id` is the comment it is on. */
  source: 'comment' | 'reaction';
  id: string; seq: string; key: string; root_id: string | null; body: string;
  author_kind: string; author_label: string | null; author_user_id: string | null;
  created_at: string; edited_at: string | null; deleted_at: string | null;
  kind: CommentReactionKind | null; active: boolean | null; count: number | null;
  /** The credential that wrote the row: a comment's author, its last editor, or the reactor. */
  author_token_id: string | null; change_token_id: string | null;
}
/** The feed position of a row: its creation, or a person's latest edit of it. */
const KEY_SQL = 'greatest(seq, coalesce(change_seq, 0))';
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
const cursorScope = (actor: AccessActor, id: string) => createHash('sha256').update(JSON.stringify([id, actor.userId ?? actor.tokenId])).digest('hex');
function decode(raw: string, scope: string): string {
  try {
    if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (cursor.v !== 1 || cursor.scope !== scope || typeof cursor.seq !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(cursor.seq) || BigInt(cursor.seq) > 9223372036854775807n) throw new Error();
    return cursor.seq;
  } catch { throw new InvalidCommentCursor(); }
}

/** Stateless checkpoint scoped to account and artifact; it never grants access.
 * Empty filtered pages advance too. has_more describes raw rows and requires an
 * immediate follow-up even when all scanned comments were agents or deleted.
 */
export async function readCommentChangesFor(actor: AccessActor, id: string, options: {
  after: string; limit: number; waitSeconds: number; signal: AbortSignal;
}): Promise<CommentChangesPage | null> {
  const db = await getDb();
  const scope = commentMonitorScope(actor);
  const identity = cursorScope(actor, id);
  // `start` replays the page's whole feed: a first watcher's view of comments made before it began.
  let position = options.after === 'now' || options.after === 'start' ? '0' : decode(options.after, identity);
  const authorized = async () => (await db.query(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id, scope.val])).rows.length > 0;
  const checkAbort = () => options.signal.throwIfAborted();
  const page = (events: CommentFeedEvent[], has_more: boolean): CommentChangesPage => ({ events, has_more, next_cursor: encode({v: 1, scope: identity, seq: position}) });
  checkAbort();
  if (!await authorized()) return null;
  if (options.after === 'now') {
    // One statement/snapshot, no separate MAX after fetching a page.
    const result = await db.query<{seq: string}>(`SELECT greatest(
      (SELECT coalesce(max(${KEY_SQL}),0) FROM annotations WHERE artifact_id=$1),
      (SELECT coalesce(max(seq),0) FROM comment_reaction_events WHERE artifact_id=$1))::text AS seq`, [id]);
    position = result.rows[0]!.seq;
    checkAbort();
    return await authorized() ? page([], false) : null;
  }
  // One scan is the bounded read plus one access check AFTER it: access still held then covers the rows read.
  const scan = async (): Promise<CommentChangesPage | null> => {
    checkAbort();
    const from = BigInt(position);
    const result = await db.query<ChangeRow>(
      `SELECT * FROM (
         SELECT 'comment' AS source,id,seq::text,${KEY_SQL} AS position,${KEY_SQL}::text AS key,root_id,body,author_kind,author_label,author_user_id,
           created_at,edited_at,deleted_at,NULL::text AS kind,NULL::boolean AS active,NULL::integer AS count,author_token_id,change_token_id
         FROM annotations WHERE artifact_id=$1 AND (seq>$2::bigint OR change_seq>$2::bigint)
         UNION ALL
         SELECT 'reaction',e.comment_id,e.seq::text,e.seq,e.seq::text,a.root_id,'',e.reactor_kind,CASE WHEN e.reactor_kind='agent' THEN e.reactor_label ELSE coalesce(u.username,e.reactor_label) END,e.user_id,
           e.created_at,NULL,a.deleted_at,e.kind,e.active,e.count,e.token_id,NULL
         FROM comment_reaction_events e JOIN annotations a ON a.id=e.comment_id LEFT JOIN users u ON u.id=e.user_id
         WHERE e.artifact_id=$1 AND e.seq>$2::bigint
       ) feed ORDER BY position LIMIT $3`, [id, position, options.limit + 1]);
    const scanned = result.rows.slice(0, options.limit);
    if (scanned.length) position = scanned[scanned.length - 1]!.key;
    // Both kinds of row advance the position; every live comment's row becomes an event, in position order.
    const live = scanned.filter(row => !row.deleted_at);
    // Credential-relative: was this written with the token reading the feed? The watcher's own account in a browser
    // is another credential, so a person's comments are never `you` to the agent watching on their behalf.
    const mine = (token: string | null) => !!actor.tokenId && token === actor.tokenId;
    const comments = live.filter(row => row.source === 'comment').map(row => {
      const created = BigInt(row.seq) > from;
      return {seq: BigInt(row.key), event: commentChangeEvent({
        id: row.id, rootId: row.root_id, authorKind: row.author_kind, label: row.author_label, userId: row.author_user_id, body: row.body,
        createdAt: row.created_at, editedAt: row.edited_at, seq: BigInt(row.seq), key: BigInt(row.key),
        you: mine(created ? row.author_token_id : row.change_token_id ?? row.author_token_id),
      }, id, from)};
    });
    const reactions = reactionChangeEvents(live.filter(row => row.source === 'reaction').map(row => ({
      seq: BigInt(row.seq), commentId: row.id, rootId: row.root_id, userId: row.author_user_id!, kind: row.kind!, active: row.active === true,
      reactorKind: row.author_kind, label: row.author_label, count: Number(row.count), createdAt: row.created_at,
      you: mine(row.author_token_id),
    })), id);
    const events: CommentFeedEvent[] = [...comments, ...reactions].sort((a, b) => a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0).map(item => item.event);
    checkAbort();
    return await authorized() ? page(events, result.rows.length > options.limit) : null;
  };
  let result = await scan();
  if (!result || result.events.length || result.has_more || !options.waitSeconds) return result;
  const releaseWait = acquireWait(actor);
  const deadline = Date.now() + options.waitSeconds * 1000;
  let wake: (() => void) | undefined;
  let pending = false;
  const notify = () => { pending = true; wake?.(); };
  let unsubscribe: (() => Promise<void>) | undefined;
  try {
    try { unsubscribe = await subscribeToAnnotations(id, notify, notify); }
    catch (error) { if (!(error instanceof TooManyLiveChannels)) throw error; }
    // Subscribe BEFORE rereading: writes during setup are caught in this scan.
    while (true) {
      pending = false;
      result = await scan();
      if (!result || result.events.length || result.has_more || Date.now() >= deadline) return result;
      checkAbort();
      // Idle: sleep until a notification, the deadline, or the next access check; only a notification or the
      // deadline earns a scan.
      while (!pending && Date.now() < deadline) {
        await sleep(Math.min(ACCESS_RECHECK_MS, Math.max(0, deadline - Date.now())));
        if (!pending && Date.now() < deadline) { checkAbort(); if (!await authorized()) return null; }
      }
    }
  } finally {
    try { await unsubscribe?.(); } finally { releaseWait(); }
  }
  /** Resolves on a notification or after `ms`; rejects with the abort reason. */
  function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); wake = undefined; };
      const finish = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(options.signal.reason); };
      const timer = setTimeout(finish, ms);
      wake = finish;
      options.signal.addEventListener('abort', abort, {once: true});
      if (options.signal.aborted) abort();
      else if (pending) finish();
    });
  }
}
