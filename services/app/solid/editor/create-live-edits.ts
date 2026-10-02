/**
 * lib/story/use-live-edits in SOLID: the framework-free core (solid/lib/live-edits-core) owned by
 * the current reactive scope. One signal mirrors the core's state; `onCleanup` is the unmount.
 *
 * `options` may be a Solid props object: the core reads it LIVE, so a new `onRemoteDocument` or
 * `isUserEditing` is used from the next call on, with no dependency list to keep in step. The
 * `initial*` fields are read once, like the hook's refs.
 */
import { createSignal, getOwner, onCleanup } from 'solid-js';
import { createLiveEditsCore, type LiveEditsOptions, type LiveEditState } from '@/solid/lib/live-edits-core';

export type { LiveEditsOptions, LiveEditState, PendingChange } from '@/solid/lib/live-edits-core';

export function createLiveEdits(options: LiveEditsOptions) {
  const core = createLiveEditsCore(() => options);
  const [state, setState] = createSignal<LiveEditState>(core.getState());
  const unsubscribe = core.subscribe(setState);
  // Outside an owner there is no unmount to hear; the caller owns `dispose` then.
  if (getOwner()) onCleanup(() => { unsubscribe(); core.dispose(); });
  return {
    /** Reactive: read inside a tracking scope to follow the status line. */
    get state() { return state(); },
    queue: core.queue,
    recover: core.recover,
    flushNow: core.flushNow,
    flushForNavigation: core.flushForNavigation,
    adoptRemote: core.adoptRemote,
    isIdle: core.isIdle,
    whenIdle: core.whenIdle,
    isOwnEdit: core.isOwnEdit,
    dispose: core.dispose,
  };
}
