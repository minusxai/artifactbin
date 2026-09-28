/**
 * THE WRITE STATUS SEAM — the empty feed until w3-viewer-writes replaces this file with
 * saving / saved / failed over the store's write events (contract `WriteStatusFeed`).
 * `boot.ts` passes it to `createIslandRuntime`, so `IslandContext.writes` is this feed.
 */
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { WriteStatusFeed } from './contract';

export function createWriteStatusFeed(_store: DataflowStore | null): WriteStatusFeed {
  return { current: () => [], subscribe: () => () => {} };
}
