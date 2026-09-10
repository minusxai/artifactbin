import type { ManagedCommentEvent, ManagedCommentState } from './managed-comment-contract';

/** Install only inside managed author content, never the app realm. */
export function createManagedCommentRuntime(_win: Window, _send: (message: ManagedCommentEvent) => void): {
  update(state: ManagedCommentState): void;
  dispose(): void;
} {
  throw new Error('managed-comment-runtime: implement');
}
