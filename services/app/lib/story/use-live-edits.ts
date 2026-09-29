'use client';

/**
 * The React editor's stable entry point for live edits. Persistence, recovery,
 * navigation, and remote adoption live in the framework-free core; React owns
 * only the hook lifetime and state subscription.
 */
export { useLiveEdits } from '@/solid/shared/use-live-edits-react';

/** The page's handle for draining edits before it unmounts the editor. */
export interface EditorFlushRef {
  current: (() => Promise<void>) | null;
}
