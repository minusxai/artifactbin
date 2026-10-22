import type {
  MigrationCommentContext,
  MigrationCommentContextInput,
} from "./comment-projection-contracts.ts";
/** Replies inherit their root's original context, as in the archived annotation contract. */
export function projectMigrationCommentContext({
  root,
  revisions,
}: MigrationCommentContextInput): MigrationCommentContext {
  const originalRevision =
    root.anchor_version == null ? "unknown" : String(root.anchor_version);
  const revision = revisions.find(
    (r) => String(r.version) === originalRevision,
  );
  if (!revision) {
    return {
      sourceRevision: null,
      nodeId: null,
      contextStatus: {
        status: "unavailable",
        originalRevision,
        reason: "not-retained",
      },
    };
  }
  const anchor =
    typeof root.anchor_key === "string" && root.anchor_key
      ? root.anchor_key
      : null;
  // An unmapped original ID remains an orphan target; never guess a current-head replacement.
  const nodeId =
    anchor && Object.hasOwn(revision.conversion.identities, anchor)
      ? revision.conversion.identities[anchor]!
      : anchor;
  return { sourceRevision: originalRevision, nodeId, contextStatus: null };
}
