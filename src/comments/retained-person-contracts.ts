/** Offline evidence supplied by the operator, never by a page or comment request. */
export interface RetainedCommentPersonEvidence {
  readonly sourceNamespace: string;
  readonly legacyPageId: string;
  readonly pageId: string;
  readonly commentId: string;
  readonly body: string;
  /** SHA256 of the immutable archived annotation bytes. */
  readonly archiveSha256: string;
  /** SHA256 of the exact page allocation/archive receipt used to bind legacyPageId to pageId. */
  readonly receiptSha256: string;
}
export interface RetainedCommentPersonEntry
  extends Omit<RetainedCommentPersonEvidence, "body"> {
  readonly bodySha256: string;
  readonly legacyUserIds: readonly string[];
}
export interface RetainedCommentPersonPlan {
  readonly format: 1;
  readonly entries: readonly RetainedCommentPersonEntry[];
}
export interface RetainedCommentPersonVerification {
  readonly entries: number;
  readonly mentions: number;
  readonly present: number;
}
