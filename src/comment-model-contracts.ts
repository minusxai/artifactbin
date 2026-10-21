import type {
  AcceptedComment,
  AcceptOptions,
  CommentDraft,
  CommentEdit,
  Snapshot,
} from "./contracts.ts";
export interface CommentAcceptanceContext {
  sourceExists: boolean;
  parentExists: boolean;
  existing: AcceptedComment | null;
  sequence: number;
}
export interface CommentAcceptance {
  comment: AcceptedComment;
  created: boolean;
  snapshot: { id: string; value: Snapshot } | null;
}
export interface CommentModel {
  accept(
    context: CommentAcceptanceContext,
    actor: string,
    draft: CommentDraft,
    snapshot: Snapshot | null,
    options: AcceptOptions,
  ): CommentAcceptance;
  edit(
    comment: AcceptedComment | null,
    actor: string,
    owner: boolean,
    expectedRevision: number,
    change: CommentEdit,
  ): AcceptedComment;
}
