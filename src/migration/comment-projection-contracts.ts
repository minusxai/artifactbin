import type { LegacyRow, PlannedRevision } from "./contracts.ts";
/** A thread belongs to its root's recorded source, never an inferred current head. */
export interface MigrationCommentContextInput {
  root: LegacyRow;
  revisions: readonly PlannedRevision[];
}
export interface MigrationCommentContext {
  sourceRevision: string | null;
  nodeId: string | null;
  contextStatus: {
    status: "unavailable";
    originalRevision: string;
    reason: "not-retained";
  } | null;
}
