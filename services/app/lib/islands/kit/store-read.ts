/**
 * A store fact an island follows: what the document's store answers now, re-read on every store
 * change. For the facts `IslandContext` has no accessor for (a mutation's write check, the writes in
 * flight, a value's declaration) — the same subscription today's runtime adapters make with
 * `useSyncExternalStore` (lib/story-runtime/StoryRuntimeApp). On the server nothing changes, so it is
 * read once.
 */
import { createSignal, onCleanup, sharedConfig } from 'solid-js';
import { isServer } from 'solid-js/web';
import type { DataflowStore } from '@/lib/story-runtime/store';

export function storeRead<T>(store: DataflowStore | null, read: () => T, served?: { value: T }): () => T {
  // Hydration keeps the served DOM as it is (Solid skips a hydrating node's attribute writes and trusts
  // the served children), so while hydrating a fact the server could not know starts at what it drew and
  // moves to the live answer once hydration has finished.
  const hydrating = !!served && !isServer && !!sharedConfig.context;
  const [value, setValue] = createSignal<T>(hydrating ? served!.value : read());
  if (store && !isServer) {
    onCleanup(store.subscribe(() => setValue(() => read())));
    if (hydrating) queueMicrotask(() => setValue(() => read()));
  }
  return value;
}

/**
 * What `mutationUnavailable` answers while the write check is in flight — lib/story-runtime/store
 * ACCESS_PENDING, restated rather than imported: importing the store module from a kit family would
 * re-partition the shared runtime's chunks (the build splits by file). kit-writes.test pins the two equal.
 */
export const ACCESS_PENDING = 'Checking edit access…';
