/**
 * COMMENT ON WHAT THE EDITOR HAS SELECTED, BY KEY — ⌘⌥M (Ctrl-Alt-M) pressed in the page, and the same key a
 * framed document forwards as `mx:comment-key` (lib/islands/frame-bridge → createInPlaceEdit's `onCommentKey`).
 * The format toolbar's "Comment on selection" is the button for the same act. Every editing surface (the hosted
 * editor, the local preview) composes this one door, so the key cannot mean different things between them.
 *
 * It only hands the selection on: commenting is a sidecar relation to the node's id, so it neither flushes nor
 * saves the draft being edited.
 */
import { onCleanup, onMount } from 'solid-js';
import type { StoryEditSelection } from '@/lib/edit-protocol';

/** ⌘⌥M / Ctrl-Alt-M. `code` too: with Option held, macOS reports the key as `µ`. */
const isCommentKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.altKey && (event.key.toLowerCase() === 'm' || event.code === 'KeyM');

export interface CommentShortcutOptions {
  /** What the editor has selected now. */
  selection: () => StoryEditSelection | null;
  /** Read live; absent for someone who may not comment, and the key then does nothing. */
  readonly onComment?: (selection: StoryEditSelection) => void;
}

/**
 * Listens for the key in this window while the calling component is mounted, and returns the same act for a
 * forwarded key. True when there was a selection to comment on (the key was used).
 */
export function createCommentShortcut(options: CommentShortcutOptions): () => boolean {
  const comment = (): boolean => {
    const onComment = options.onComment;
    const current = onComment ? options.selection() : null;
    if (!onComment || !current) return false;
    onComment(current);
    return true;
  };
  onMount(() => {
    const onKey = (event: KeyboardEvent) => { if (isCommentKey(event) && comment()) event.preventDefault(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  return comment;
}
