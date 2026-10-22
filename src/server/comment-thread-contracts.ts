import type { CommentRecord } from "./af-api-contracts.ts";
export interface CommentThreadResponse {
  selectedId: string;
  rootId: string;
  comments: CommentRecord[];
}
/** Includes root and replies. A larger thread returns 413 without partial data. */
export const MAX_COMMENT_THREAD_RECORDS = 200;

export const MAX_COMMENT_THREAD_BYTES = 1_000_000;
