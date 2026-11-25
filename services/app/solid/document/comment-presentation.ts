/** A readable page admits comments without mounting the discussion UI until it has something to show. */
export interface CommentPresentation {
  canRead: boolean;
  active: boolean;
  linked: boolean;
  railOpen: boolean;
  composing: boolean;
  picking: boolean;
  openCount: number;
  liveCount: number;
}
export function needsCommentPresentation(state: CommentPresentation): boolean {
  return state.canRead && (state.active || state.linked || state.railOpen || state.composing || state.picking || state.openCount > 0 || state.liveCount > 0);
}

/** Only active threads contribute to reader counts and unread indicators. */
export function openAnnotations<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status === 'open');
}

/** Project an address for lazy loading, target lookup and initial editor focus. */
export function commentLink(search: string | undefined) {
  const query = new URLSearchParams(search);
  const comment = query.get('comment');
  const thread = query.get('thread');
  return {
    target: comment ?? thread,
    requested: Boolean(comment || thread),
    takesFocus: comment !== null || thread !== null || query.get('intent') === 'comment',
  };
}
