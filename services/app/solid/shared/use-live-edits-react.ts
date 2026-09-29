/**
 * The same core as a React hook, to prove solid/shared/live-edits-core is framework-free: the whole
 * React-specific part is one `useSyncExternalStore` and one effect for the lifetime. It keeps
 * lib/story/use-live-edits' signature and return shape, so that hook's own suite runs against it
 * unmodified (solid/__tests__/live-edits-react-adapter.test.ts).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createLiveEditsCore, type LiveEditsOptions } from './live-edits-core';

export function useLiveEdits(options: LiveEditsOptions) {
  // The core reads options live; this ref is what "live" means under React.
  const latest = useRef(options);
  latest.current = options;
  const [core] = useState(() => createLiveEditsCore(() => latest.current));
  const state = useSyncExternalStore(core.subscribe, core.getState, core.getState);
  useEffect(() => {
    core.attach();
    return () => core.dispose();
  }, [core]);
  return {
    state,
    queue: core.queue,
    recover: core.recover,
    flushNow: core.flushNow,
    flushForNavigation: core.flushForNavigation,
    adoptRemote: core.adoptRemote,
    isIdle: core.isIdle,
    isOwnEdit: core.isOwnEdit,
  };
}
