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
