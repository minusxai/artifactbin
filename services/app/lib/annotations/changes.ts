/** Committed human comments. NOTIFY only wakes readers; bounded SQL scans own replay.
 * Both annotation INSERT paths lock the artifact before allocating seq, through commit.
 * Thus a visible same-artifact high watermark cannot skip a later low-seq commit.
 */
import { createHash } from 'node:crypto';
import type { CommentChangesPage, CommentChangeEvent } from '@artifactbin/contracts';
import type { TokenActor } from '@/lib/accounts/actors';
import { annotationScope } from '@/lib/artifacts/access';
import { getDb } from '@/lib/platform/db';
import { subscribeToAnnotations, TooManyLiveChannels } from '@/lib/story/realtime/live';

export class InvalidCommentCursor extends Error {}
export class CommentWaitCapacityError extends Error {}

// Concurrency leases, not historical request buckets: keys disappear when their
// last wait finishes, and the process cap bounds the registry to 128 keys.
// Each replica enforces its own caps; this is not a distributed account quota.
const MAX_ACCOUNT_WAITS = 4;
const MAX_PROCESS_WAITS = 128;
const accountWaits = new Map<string, number>();
let activeWaits = 0;
function acquireWait(actor: TokenActor): () => void {
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
  id: string; seq: string; root_id: string | null; body: string;
  author_kind: string; author_label: string | null; author_user_id: string | null;
  created_at: string; deleted_at: string | null;
}
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
const cursorScope = (actor: TokenActor, id: string) => createHash('sha256').update(JSON.stringify([id, actor.userId ?? actor.tokenId])).digest('hex');
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
export async function readCommentChangesFor(actor: TokenActor, id: string, options: {
  after: string; limit: number; waitSeconds: number; signal: AbortSignal;
}): Promise<CommentChangesPage | null> {
  const db = await getDb();
  const scope = annotationScope(actor);
  const identity = cursorScope(actor, id);
  let position = options.after === 'now' ? '0' : decode(options.after, identity);
  const authorized = async () => (await db.query(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id, scope.val])).rows.length > 0;
  const checkAbort = () => options.signal.throwIfAborted();
  const page = (events: CommentChangeEvent[], has_more: boolean): CommentChangesPage => ({ events, has_more, next_cursor: encode({v: 1, scope: identity, seq: position}) });
  checkAbort();
  if (!await authorized()) return null;
  if (options.after === 'now') {
    // One statement/snapshot, no separate MAX after fetching a page.
    const result = await db.query<{seq: string}>('SELECT coalesce(max(seq),0)::text AS seq FROM annotations WHERE artifact_id=$1', [id]);
    position = result.rows[0]!.seq;
    checkAbort();
    return await authorized() ? page([], false) : null;
  }
  const scan = async (): Promise<CommentChangesPage | null> => {
    checkAbort();
    if (!await authorized()) return null;
    const result = await db.query<ChangeRow>(
      `SELECT id,seq::text,root_id,body,author_kind,author_label,author_user_id,created_at,deleted_at
       FROM annotations WHERE artifact_id=$1 AND seq>$2::bigint ORDER BY seq LIMIT $3`, [id, position, options.limit + 1]);
    const scanned = result.rows.slice(0, options.limit);
    if (scanned.length) position = scanned[scanned.length - 1]!.seq;
    const events: CommentChangeEvent[] = scanned.filter(row => row.author_kind === 'human' && !row.deleted_at).map(row => ({
      type: 'artifactbin.comment', event_id: row.id, artifact_id: id, annotation_id: row.root_id ?? row.id, comment_id: row.id,
      author: {kind: 'human', label: row.author_label, user_id: row.author_user_id}, body: row.body, created_at: row.created_at,
    }));
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
      if (pending) continue;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); wake = undefined; };
        const finish = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(options.signal.reason); };
        // Membership revocation need not send an annotation wakeup. Revalidate at
        // least once each second; the wait holds no database transaction or lock.
        const timer = setTimeout(finish, Math.min(1000, Math.max(0, deadline - Date.now())));
        wake = finish;
        options.signal.addEventListener('abort', abort, {once: true});
        if (options.signal.aborted) abort();
        else if (pending) finish();
      });
    }
  } finally {
    try { await unsubscribe?.(); } finally { releaseWait(); }
  }
}
