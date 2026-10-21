import type { DocumentState } from "../contracts.ts";
import type {
  CommentAccessInput,
  CommentAccess,
  CommentCommand,
  CommentCommandContext,
  PreparedComment,
} from "./comment-command-contracts.ts";
import { localComment, validateSnapshot } from "../model.ts";
import { fail } from "../errors.ts";
/** Hosted comments require server permission. Portable copies remain locally editable. */
export function commentAccess(input: CommentAccessInput): CommentAccess {
  return {
    allowed:
      input.active &&
      (input.placement === "portable" || input.permission === true),
    notice: !input.active
      ? "Saved views are read-only. Return to resume your work."
      : input.authenticated
        ? "You have view-only access. Ask an editor for commenting access."
        : "Sign in to comment.",
  };
}
/** Pure command boundary. Rejection leaves caller state intact; persistence/network happen only after success. */
export function prepareComment(
  state: DocumentState,
  command: CommentCommand,
  context: CommentCommandContext,
): PreparedComment {
  const access = commentAccess(context.access);
  if (!access.allowed) fail(403, access.notice);
  if (!command.body.trim()) fail(422, "Comment cannot be empty");
  if (
    command.parentId &&
    !state.comments.some(
      (comment) =>
        comment.id === command.parentId &&
        !comment.parentId &&
        !comment.resolved,
    )
  )
    fail(409, "Comment thread is unavailable");
  const sourceRevision =
    command.selection.snapshot?.sourceRevision || context.sourceRevision;
  const sources = { ...state.sources, [state.sourceRevision]: "" };
  if (!Object.hasOwn(sources, sourceRevision))
    fail(409, "Comment source is unavailable");
  const snapshot = validateSnapshot(
    { sources },
    command.selection.snapshot,
    sourceRevision,
  );
  const id = context.id(),
    snapshotId = snapshot ? context.id() : null;
  if (snapshotId && Object.hasOwn(state.snapshots, snapshotId))
    fail(409, "Snapshot ID conflict");
  const next = localComment(
    state,
    {
      id,
      nodeId: command.selection.nodeId,
      quote: command.selection.quote,
      body: command.body,
      sourceRevision,
      parentId: command.parentId,
    },
    snapshot,
    snapshotId,
    context.now,
  );
  return { state: next, id, synchronize: context.connected };
}
