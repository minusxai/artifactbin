/**
 * A store fact an island follows through its context (`IslandContext.mutationUnavailable`, `mutating`:
 * reactive, re-read on every store change — the subscription the former runtime adapters made with
 * `useSyncExternalStore`), held at what the server drew while the
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

export { ACCESS_PENDING } from '@/lib/story-runtime/contract';
