/** The frame editor's side of comment state: capture validated as bounded JSON for the wire, and a saved view checked before it is put back. */
import { parseCommentViewState, type CommentViewState } from '../../../../contracts/src/comment-view-state';
import { captureCommentState, restoreCommentState } from '../comment-state-io';

/** Freeze context at the selection gesture, before the composer changes focus. */
export function withCommentState<T extends object>(doc: Document, selection: T): T & { viewState?: CommentViewState; viewStateError?: string } {
  try {
    const captured = captureCommentState(doc);
    if (!captured) return selection;
    const viewState = parseCommentViewState(captured);
    if (!viewState) throw new Error('Comment state must be bounded JSON data.');
    return { ...selection, viewState };
  } catch { return { ...selection, viewStateError: 'This view could not be saved. The comment will remember its target only.' }; }
}

/** Put a thread's saved view back; throws on an invalid snapshot or a part that refuses its value. */
export function restoreSavedView(doc: Document, input: unknown): void {
  const saved = parseCommentViewState(input);
  if (!saved) throw new Error('Invalid saved view.');
  restoreCommentState(doc, saved);
}
