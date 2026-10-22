import type { AcceptedComment, Comment } from "../contracts.ts";
/** One complete bounded thread; larger threads fail explicitly rather than silently truncate. */
export interface CommentThread {
  selectedId: string;
  rootId: string;
  comments: AcceptedComment[];
}
export interface CommentLinkOptions {
  readThread(id: string, signal: AbortSignal): Promise<CommentThread>;
  install(thread: CommentThread): void;
  showComment(comment: Comment): Promise<void>;
  openThread(rootId: string, selectedId: string): void;
  error(message: string): void;
}
export interface CommentLinkController {
  open(search: URLSearchParams): Promise<void>;
  invalidate(): void;
  dispose(): void;
}
