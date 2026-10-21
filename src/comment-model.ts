import type { CommentModel } from "./comment-model-contracts.ts";
import type { CommentDraft, Snapshot, Json } from "./contracts.ts";
import { jsonCopy } from "./json.ts";
import { canonical, text } from "./model-values.ts";
import { fail } from "./errors.ts";
export function validateLoadedSnapshot(
  sourceExists: boolean,
  snapshot: Snapshot | null,
  revision: string,
): Snapshot | null {
  if (snapshot === null) return null;
  const copy = jsonCopy(snapshot) as Snapshot;
  if (copy.sourceRevision !== revision || !sourceExists)
    fail(409, "Snapshot source is unavailable");
  if (
    !Number.isInteger(copy.schema) ||
    copy.schema < 0 ||
    !copy.state ||
    typeof copy.state !== "object" ||
    Array.isArray(copy.state)
  )
    fail(422, "Invalid snapshot schema or state");
  if (
    !copy.view ||
    !Number.isFinite(copy.view.x) ||
    !Number.isFinite(copy.view.y)
  )
    fail(422, "Invalid snapshot viewport");
  if (
    copy.rendered !== undefined &&
    (typeof copy.rendered !== "string" || copy.rendered.length > 200000)
  )
    fail(422, "Invalid rendered snapshot");
  return copy;
}
function validateDraft(draft: CommentDraft) {
  text(draft.id, 100);
  text(draft.body);
  text(draft.sourceRevision, 100);
  if (draft.nodeId !== null && typeof draft.nodeId !== "string")
    fail(422, "Invalid comment anchor");
  if (draft.parentId !== null && typeof draft.parentId !== "string")
    fail(422, "Invalid reply parent");
}
export const acceptLoadedComment: CommentModel["accept"] = (
  context,
  actor,
  draft,
  snapshot,
  options,
) => {
  if (!actor) fail(401, "Sign in to sync comments");
  validateDraft(draft);
  if (!context.sourceExists)
    fail(409, "Publish this source before syncing its comments");
  const saved = validateLoadedSnapshot(
      context.sourceExists,
      snapshot,
      draft.sourceRevision,
    ),
    payload = {
      nodeId: draft.nodeId,
      quote: String(draft.quote || "").slice(0, 500),
      body: draft.body,
      parentId: draft.parentId,
      sourceRevision: draft.sourceRevision,
      snapshot: saved,
    };
  const fingerprint = options.digest(canonical(payload as unknown as Json)),
    previous = context.existing;
  if (previous) {
    if (previous.fingerprint !== fingerprint) fail(409, "Comment ID conflict");
    return { comment: previous, created: false, snapshot: null };
  }
  if (draft.parentId && !context.parentExists)
    fail(409, "Reply parent unavailable");
  const sid = saved
    ? options.digest(canonical(saved as unknown as Json))
    : null;
  const comment = {
    ...draft,
    quote: payload.quote,
    appStateId: sid,
    publishedBy: actor,
    fingerprint,
    sequence: context.sequence + 1,
    createdAt: new Date(options.now).toISOString(),
    revision: 1,
    resolved: false,
  };
  return {
    comment,
    created: true,
    snapshot: sid && saved ? { id: sid, value: saved } : null,
  };
};
export const editLoadedComment: CommentModel["edit"] = (
  old,
  actor,
  owner,
  expected,
  edit,
) => {
  if (!old) fail(404, "Comment unavailable");
  if (!actor || (old.publishedBy !== actor && !owner))
    fail(403, "Only the author or owner can edit");
  if (old.revision !== expected)
    fail(409, "Comment changed. Fetch it before editing.");
  const comment = {
    ...old,
    ...(edit.body !== undefined ? { body: text(edit.body) } : {}),
    ...(edit.resolved !== undefined ? { resolved: !!edit.resolved } : {}),
    revision: old.revision + 1,
  };
  return comment;
};
