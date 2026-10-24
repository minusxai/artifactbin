/** A readable page admits comments without mounting the discussion UI until it has something to show. */
export interface CommentPresentation {
  canRead: boolean;
  active: boolean;
  linked: boolean;
  railOpen: boolean;
  composing: boolean;
  openCount: number;
  liveCount: number;
}
export function needsCommentPresentation(state: CommentPresentation): boolean {
  return state.canRead && (state.active || state.linked || state.railOpen || state.composing || state.openCount > 0 || state.liveCount > 0);
}
