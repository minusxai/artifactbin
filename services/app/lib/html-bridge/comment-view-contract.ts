import type { CommentViewState } from '../../../contracts/src/comment-view-state';
/** Only explicitly declared top-level UI fields may leave the viewer's private store. */
export interface HtmlCommentViewPort {
  capture(): CommentViewState | null;
  /** Reject incompatible snapshots before any write. Never calls a backend. */
  restore(input: unknown): Promise<void>;
}
export interface HtmlCommentViewCommand { openId?: string | null; viewStateRequest?: number; pins?: readonly { id: string; viewState?: unknown }[] }
