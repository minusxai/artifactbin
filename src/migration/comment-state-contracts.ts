import type { JsonObject, Snapshot, CommentStateReplay } from "../contracts.ts";
/** Source and normalized seed must belong to this exact retained revision. */
export interface MigrationCommentStateInput {
  raw: unknown;
  sourceRevision: string | null;
  legacySource: string | null;
  initialState: JsonObject | null;
}
export interface MigrationCommentStateProjection {
  /** Original inert payload is retained even when it cannot be replayed. */
  raw: unknown;
  status: CommentStateReplay;
  snapshot: Snapshot | null;
}
