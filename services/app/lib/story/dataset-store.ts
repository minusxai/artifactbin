/**
 * Where dataset ROWS actually live.
 *
 * They used to sit in `artifacts.content` as JSON. That is fine for the twenty
 * rows an agent hand-writes and wrong for a file: a real Google Sheet arrived
 * at 27 MB, and every render and every /edits write reads and parses the whole
 * column — with PGLite holding it in one process. So the rows go to the object
 * store and the row keeps a reference.
 *
 * Both directions live here so no caller has to know where a given
 * artifact's rows are.
 */
import { objectKey, objectStore } from '@/lib/object-store';

/** Where a dataset's rows are, if not inline. */
export interface DatasetLocation {
  /** JSON to store in `artifacts.content` — empty when the rows went to the store. */
  content: string;
  /** Object key, or null when the rows are inline. */
  objectKey: string | null;
}

/**
 * Persist rows. Content-addressed, so re-uploading the same file costs one
 * object rather than one per artifact.
 */
export async function storeDatasetRows(rows: unknown[]): Promise<DatasetLocation> {
  const json = JSON.stringify(rows);
  const key = objectKey('dataset', json);
  await objectStore().put(key, json, 'application/json');
  // `content` is NOT NULL, and an empty string is the honest value: the rows
  // are elsewhere. A reader keys off objectKey, never off content being empty.
  return { content: '', objectKey: key };
}

/**
 * Read rows back, from wherever they are. Returns [] rather than throwing when
 * an object has gone missing: a chart degrading to empty is better than a page
 * that will not render, and the embed already has a no-data fallback.
 */
export async function loadDatasetRows(row: { content: string; meta: unknown }): Promise<Record<string, unknown>[]> {
  const key = (row.meta as { objectKey?: unknown } | null)?.objectKey;
  if (typeof key !== 'string' || !key) return [];
  // A row that names a key promises rows; a store that cannot produce them
  // is an ERROR (ObjectUnavailable) the caller surfaces — never `[]`, which
  // would draw an empty chart over a broken bucket. Repeat reads cost one
  // fetch because the STORE caches them (lib/object-store `cachedReads`) —
  // deliberately not here, so there is one cache and not one per caller.
  return JSON.parse((await objectStore().get(key)).toString('utf8'));
}
