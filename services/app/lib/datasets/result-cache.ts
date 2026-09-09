import type { Db } from '@/lib/db';
import type { CatalogResult } from './execute';

export interface ResultCacheOptions {
  maxBytes?: number;
  maxEntries?: number;
  leaseMs?: number;
  waitMs?: number;
}
export interface ResultCacheRequest {
  ttlSeconds: number;
  refresh?: boolean;
  signal?: AbortSignal;
  /** Must check live authorization/credential binding, including after waits. */
  authorize(): Promise<void>;
}
export interface DatasetResultCache {
  run(key: string, load: () => Promise<CatalogResult>, request: ResultCacheRequest): Promise<CatalogResult>;
}
/** Database-owned cache; no process-global result map, no upstream work in a transaction. */
export function createDatasetResultCache(_db: Db, _options?: ResultCacheOptions): DatasetResultCache {
  throw new Error('M0: implement shared result cache');
}
