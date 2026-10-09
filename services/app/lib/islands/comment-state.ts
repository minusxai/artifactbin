/**
 * NAMED SIGNALS ARE COMMENTABLE: the islands side of lib/story-runtime/comment-state. A kit element's view state
 * registers under its own node id (`<id>:value`); a script's `createSignal(value, {name})` under the node id of the
 * mount its component renders in (`<mount id>:<name>`), or the bare name at module level. Server rendering, and a
 * kit element with neither an id nor a mount around it (a row of a `For`), register nothing.
 */
import { createContext, createSignal, getOwner, onCleanup, untrack, useContext, type Signal, type SignalOptions } from 'solid-js';
import type { ReviewJson } from '@artifactbin/contracts';
import { registerCommentState } from '@/lib/story-runtime/comment-state';

/** The source node a script component mounts at (page-runtime mountComponents provides it). */
export const MountScope = createContext<string | null>(null);

/** The key a signal named `name` registers under: the element's own id, else the mount around it; null when neither. */
export function commentStateKey(name: string, id?: string | null): string | null {
  if (id) return `${id}:${name}`;
  const scope = useContext(MountScope);
  return scope ? `${scope}:${name}` : null;
}

/**
 * A Solid signal registered as comment state under `key`: plain when it has no key or renders on the server. A pending
 * restore sets it as it registers. Unregistered with its owner; without one (a module-level signal), `removals` keeps
 * the remover for the module's stop.
 */
export function commentSignal<T>(key: string | null, value: T, options?: SignalOptions<T>, removals?: Set<() => void>): Signal<T> {
  const [get, set] = createSignal<T>(value, options);
  if (!key || typeof document === 'undefined') return [get, set];
  const remove = registerCommentState(document, key, { get: () => untrack(get), set: (next: ReviewJson) => { set(() => next as T); } });
  if (getOwner()) onCleanup(remove); else removals?.add(remove);
  return [get, set];
}

/** A kit element's uncontrolled view state: comment state under its node id unless a bound prop controls it. */
export const kitSignal = <T,>(name: string, props: { id?: string }, controlled: unknown, value: T): Signal<T> =>
  commentSignal(controlled === undefined ? commentStateKey(name, props.id) : null, value);
