/**
 * NAMED SIGNALS ARE COMMENTABLE: the islands side of lib/story-runtime/comment-state. A kit element's view state
 * registers under its own node id (`<id>:value`); a script's `createSignal(value, {name})` under the node id of the
 * mount its component renders in (`<mount id>:<name>`), or the bare name at module level. Server rendering, and a
 * kit element with neither an id nor a mount around it (a row of a `For`), register nothing.
 */
import { createContext, createSignal, getOwner, onCleanup, untrack, useContext, type Signal, type SignalOptions } from 'solid-js';
import type { ReviewJson } from '@artifactbin/contracts';
import { pendingCommentState, registerCommentState } from '@/lib/story-runtime/comment-state';

/** The source node a script component mounts at (page-runtime mountComponents provides it). */
export const MountScope = createContext<string | null>(null);

/** The key a signal named `name` registers under: the element's own id, else the mount around it; null when neither. */
export function commentStateKey(name: string, id?: string | null): string | null {
  if (id) return `${id}:${name}`;
  const scope = useContext(MountScope);
  return scope ? `${scope}:${name}` : null;
}

/** A Solid signal registered as comment state under `key`, with its unregister (a pending restore seeds the first value). */
export function registerCommentSignal<T>(key: string, value: T, options?: SignalOptions<T>): { signal: Signal<T>; remove: () => void } {
  const saved = pendingCommentState(document, key);
  const [get, set] = createSignal<T>(saved === undefined ? value : (saved as T), options);
  const remove = registerCommentState(document, key, { get: () => untrack(get), set: (next: ReviewJson) => { set(() => next as T); } });
  return { signal: [get, set], remove };
}

/** A kit element's commentable signal: plain when it has no key or renders on the server; unregistered with its owner. */
export function commentSignal<T>(key: string | null, value: T, options?: SignalOptions<T>): Signal<T> {
  if (!key || typeof document === 'undefined') return createSignal(value, options);
  const { signal, remove } = registerCommentSignal(key, value, options);
  if (getOwner()) onCleanup(remove);
  return signal;
}
