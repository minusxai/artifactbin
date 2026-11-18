/**
 * THE OBJECT SWEEP: deletes stored content objects no row references any more, so storage does not only grow.
 *
 * WHAT IT MAY DELETE. Only keys of the SWEPT_KINDS (`dataset/`, `image/`, `pdf/`, `file/`, content-addressed by
 * `objectKey`), and only keys recorded in `object_writes`: the store is never listed (the IAM user has no
 * s3:ListBucket, see ObjectUnavailable), so an object written before that table existed is never a candidate. Every
 * reader of these kinds takes its key from a row (artifact and version `meta`, `dataset_images.meta`, the catalog
 * tables inside them), so "referenced" means: the key's text occurs in some row of some app table (`TABLES`), any
 * column, any version. That is deliberately wider than the readers' columns: a false "referenced" keeps an object,
 * a false "unreferenced" would lose one.
 *
 * WHY A CONCURRENT PUBLISH NEVER LOSES ITS OBJECT. Keys are content-addressed, so a publish may be about to reference
 * an object that is an old orphan, and the local store keeps an identical file's old mtime; object timestamps prove
 * nothing. The argument rests on the `object_writes` row instead:
 *  1. Every put of a swept kind through `objectStore()` is preceded by a committed upsert of its row with
 *     `due_at >= now() + SWEEP_MARGIN_MS` (`recordObjectWrites`; a put inside a transaction, the publishing
 *     transaction's last step, is recorded just before that transaction opens: `preparedPersistence`).
 *  2. The sweep scans for references to due keys, then deletes the unreferenced ones in transactions that each hold
 *     a few of their rows FOR UPDATE and recheck `due_at < now()` there, deleting each object before its row, and
 *     every delete settled before the transaction ends (`deleteHeldObjects`): no delete is still in flight once the
 *     locks go.
 *  So a writer's upsert either commits before that recheck (the row is young: the sweep skips it) or waits for the
 *  sweep's commit and then inserts a fresh row before its put re-creates the object. A writer references its object
 *  within seconds of recording it, far inside the margin, so a key due when the scan ran has its reference, if any,
 *  committed and seen by the scan.
 *  A referenced key's row is pushed RECHECK_MS ahead (a reference deleted later is found then); an unreferenced
 *  one's object and row go. A delete that fails keeps its row, and so does a crash between the two: the next sweep
 *  deletes again (idempotent). A reference scan that fails deletes nothing.
 *
 * BOUNDED AND RESTARTABLE: each run takes at most `batch` due rows, oldest first, and holds no state outside the
 * table. The export cache expires its own images (lib/export `expireExportImages`); lib/runtime runs both.
 */
import { getDb, TABLES, type Db, type Queryable } from '@/lib/platform';
import type { ObjectStore } from './index';

/** The content-addressed kinds the sweep owns: every put of them is recorded, and every reference is a row. */
const SWEPT_KINDS = ['dataset', 'image', 'pdf', 'file'] as const;
/** How many orphans one delete transaction locks: few, so a write waiting on one of their rows stays inside its lock_timeout. */
const DELETE_CHUNK = 25;
/** How long a recorded write is kept whatever references it: far longer than any publish takes to commit. */
const SWEEP_MARGIN_MS = 24 * 60 * 60 * 1000;
/** A key found referenced is looked at again after this long. */
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a key this process recorded may be put again without recording it again (well inside the margin). */
const RECORDED_FOR_MS = 10 * 60 * 1000;
const SWEPT = new RegExp(`^(?:${SWEPT_KINDS.join('|')})/[0-9a-f]{32}$`);
/** Finds every swept key written anywhere in a row's text. */
const KEY_TEXT = `((?:${SWEPT_KINDS.join('|')})/[0-9a-f]{32})`;

const recorded = new Map<string, number>();
/** Test seam: forget which keys this process recorded. */
export function forgetRecordedWrites(): void { recorded.clear(); }

/**
 * Records that these keys are about to be written: a committed statement, so it never runs inside a transaction
 * (PGLite has one connection). Keys of other kinds are ignored.
 */
export async function recordObjectWrites(keys: readonly string[], db?: Queryable): Promise<void> {
  const swept = [...new Set(keys.filter(key => SWEPT.test(key)))];
  if (!swept.length) return;
  await (db ?? await getDb()).query(`INSERT INTO object_writes (key, due_at)
    SELECT key, now() + $2::bigint * interval '1 millisecond' FROM unnest($1::text[]) AS key
    ON CONFLICT (key) DO UPDATE SET due_at = GREATEST(object_writes.due_at, EXCLUDED.due_at)`, [swept, SWEEP_MARGIN_MS]);
  const until = Date.now() + RECORDED_FOR_MS;
  for (const key of swept) recorded.set(key, until);
  if (recorded.size > 10_000) for (const [key, at] of recorded) if (at < Date.now()) recorded.delete(key);
}

/** The store whose puts of swept kinds are recorded first, unless this process recorded the key moments ago. */
export function recordedWrites(store: ObjectStore): ObjectStore {
  return {
    ...store,
    async put(key, body, contentType) {
      if (SWEPT.test(key) && !((recorded.get(key) ?? 0) > Date.now())) await recordObjectWrites([key]);
      await store.put(key, body, contentType);
    },
  };
}

/** Of these keys, the ones whose text occurs in some row of some app table. */
async function referencedKeys(db: Queryable, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const table of TABLES) {
    if (table.name === 'object_writes') continue;
    const rows = await db.query<{ key: string }>(`SELECT DISTINCT m[1] AS key
      FROM ${table.name} t, regexp_matches(t::text, '${KEY_TEXT}', 'g') AS m WHERE m[1] = ANY($1::text[])`, [keys]);
    for (const row of rows.rows) found.add(row.key);
  }
  return found;
}

/**
 * Deletes these objects while `tx` holds the rows that guard them: all at once, and every one settled (deleted or
 * failed) before this returns, so none is in flight once the transaction ends and its locks go. Awaiting the store is
 * idle time to the database, so the transaction's idle timeout is lifted first: past the pool's
 * idle_in_transaction_session_timeout the database would end the session, and with it the locks, while the deletes
 * still run. The store bounds each call (createS3Store's timeouts), so the transaction stays bounded.
 */
export async function deleteHeldObjects(tx: Queryable, store: Pick<ObjectStore, 'delete'>, keys: readonly string[]): Promise<{ deleted: string[]; failed: unknown[] }> {
  if (!keys.length) return { deleted: [], failed: [] };
  await tx.query('SET LOCAL idle_in_transaction_session_timeout = 0');
  const settled = await Promise.allSettled(keys.map(key => store.delete(key)));
  return {
    deleted: keys.filter((_, at) => settled[at]!.status === 'fulfilled'),
    failed: settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []),
  };
}

/** The error of deletes that failed (their rows are kept for the next run), after the others committed. */
export function failedDeletes(what: string, failed: readonly unknown[]): AggregateError {
  const first = failed[0] instanceof Error ? failed[0].message : String(failed[0]);
  return new AggregateError(failed, `${failed.length} of ${what} failed and stay for the next run: ${first}`);
}

/**
 * One bounded sweep: due rows, oldest first. The reference scan runs outside any transaction (it reads every table);
 * each delete transaction re-takes a few orphans' rows FOR UPDATE and rechecks `due_at`, so a write recorded since the
 * scan keeps its object. Returns what it deleted and how many keys it found still referenced; throws, after committing
 * the rest, when a delete failed.
 */
export async function sweepObjects(db: Db, store: Pick<ObjectStore, 'delete'>, { batch = 500 }: { batch?: number } = {}): Promise<{ deleted: string[]; kept: number }> {
  const due = (await db.query<{ key: string }>('SELECT key FROM object_writes WHERE due_at < now() ORDER BY due_at LIMIT $1',
    [batch])).rows.map(row => row.key);
  if (!due.length) return { deleted: [], kept: 0 };
  const referenced = await referencedKeys(db, due);
  if (referenced.size) await db.query(`UPDATE object_writes SET due_at = now() + $2::bigint * interval '1 millisecond'
    WHERE key = ANY($1::text[]) AND due_at < now()`, [[...referenced], RECHECK_MS]);
  const unreferenced = due.filter(key => !referenced.has(key));
  const deleted: string[] = [], failed: unknown[] = [];
  for (let at = 0; at < unreferenced.length; at += DELETE_CHUNK) {
    const chunk = unreferenced.slice(at, at + DELETE_CHUNK);
    const done = await db.transaction(async tx => {
      const orphans = (await tx.query<{ key: string }>(`SELECT key FROM object_writes WHERE key = ANY($1::text[]) AND due_at < now()
        ORDER BY key FOR UPDATE SKIP LOCKED`, [chunk])).rows.map(row => row.key);
      const out = await deleteHeldObjects(tx, store, orphans);
      if (out.deleted.length) await tx.query('DELETE FROM object_writes WHERE key = ANY($1::text[])', [out.deleted]);
      return out;
    });
    deleted.push(...done.deleted); failed.push(...done.failed);
  }
  if (failed.length) throw failedDeletes('the sweep\'s deletes', failed);
  return { deleted, kept: referenced.size };
}
