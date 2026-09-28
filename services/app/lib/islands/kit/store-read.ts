/**
 * A store fact an island follows through its context (`IslandContext.mutationUnavailable`, `mutating`:
 * reactive, re-read on every store change — the subscription today's runtime adapters make with
 * `useSyncExternalStore`, lib/story-runtime/StoryRuntimeApp), held at what the server drew while the
 * page hydrates.
 */
import { createSignal, sharedConfig } from 'solid-js';
import { isServer } from 'solid-js/web';

export function hydratedRead<T>(read: () => T, served?: { value: T }): () => T {
  // Hydration keeps the served DOM as it is (Solid skips a hydrating node's attribute writes and trusts
  // the served children), so while hydrating a fact the server could not know starts at what it drew and
  // moves to the live answer once hydration has finished.
  if (!served || isServer || !sharedConfig.context) return read;
  const [live, setLive] = createSignal(false);
  queueMicrotask(() => setLive(true));
  return () => (live() ? read() : served.value);
}

/**
 * What `mutationUnavailable` answers while the write check is in flight — lib/story-runtime/store
 * ACCESS_PENDING, restated rather than imported: importing the store module from a kit family would
 * re-partition the shared runtime's chunks (the build splits by file). kit-writes.test pins the two equal.
 */
export const ACCESS_PENDING = 'Checking edit access…';
