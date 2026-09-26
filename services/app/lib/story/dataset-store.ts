/**
 * Where dataset ROWS actually live.
 *
 * Rows live in the object store. A real sheet can be tens of megabytes, so
 * artifact reads and edits carry only its object key.
 *
 * Both directions live here so no caller has to know where a given
 * artifact's rows are.
 */
import { objectKey, objectStore } from '@/lib/object-store';

/** Where a dataset's rows are. */
interface DatasetLocation {
  objectKey: string;
}

/**
 * Persist rows. Content-addressed, so re-uploading the same file costs one
 * object rather than one per artifact.
 */
export async function storeDatasetRows(rows: unknown[], store: Pick<import('@/lib/object-store').ObjectStore, 'put'> = objectStore()): Promise<DatasetLocation> {
  const json = JSON.stringify(rows);
  const key = objectKey('dataset', json);
  await store.put(key, json, 'application/json');
  return { objectKey: key };
}

/**
 * Read object-backed rows. An unreadable
 * referenced object throws; it must never masquerade as an empty table.
 */
export async function loadDatasetRows(row: { meta: unknown }): Promise<Record<string, unknown>[]> {
  const key = (row.meta as { objectKey?: unknown } | null)?.objectKey;
  if (typeof key !== 'string' || !key) return [];
  // A row that names a key promises rows; a store that cannot produce them
  // is an ERROR (ObjectUnavailable) the caller surfaces — never `[]`, which
  // would draw an empty chart over a broken bucket. Repeat reads cost one
  // fetch because the STORE caches them (lib/object-store `cachedReads`) —
  // deliberately not here, so there is one cache and not one per caller.
  return JSON.parse((await objectStore().get(key)).toString('utf8'));
}

/**
 * How many rows a stored object holds and how many bytes it serializes to —
 * the two things the hold cap is judged by (lib/story/placement). Remembered
 * by key: objects are content-addressed, so a key's answer never changes, and
 * a page render asking whether its reader may hold a dataset pays one parse
 * per dataset version per process, not one per render. An object past
 * `maxBytes` is not parsed at all: it is too big whatever it holds.
 */
const statsByKey = new Map<string, { rows: number; bytes: number }>();
const STATS_KEPT = 2_000;

export async function storedRowStats(key: string, maxBytes: number): Promise<{ rows: number; bytes: number }> {
  const known = statsByKey.get(key);
  if (known) return known;
  const bytes = await objectStore().get(key);
  const stats = { bytes: bytes.length, rows: bytes.length > maxBytes ? Number.POSITIVE_INFINITY : (JSON.parse(bytes.toString('utf8')) as unknown[]).length };
  if (statsByKey.size >= STATS_KEPT) statsByKey.delete(statsByKey.keys().next().value!);
  statsByKey.set(key, stats);
  return stats;
}
