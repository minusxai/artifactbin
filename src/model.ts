import { isStableNodeId } from "./domain/stable-node-id.ts";
import { validateSelection } from "./domain/selection-presence.ts";
import { preparePublication } from "./publication-model.ts";
import type {
  CollaborationModel,
  CommentDraft,
  SharedFile,
  Snapshot,
  PresenceEntry,
  PresenceClock,
} from "./contracts.js";
import { jsonCopy } from "./json.ts";
import { fail } from "./errors.ts";
export { fail } from "./errors.ts";
import { text } from "./model-values.ts";
export { text, canonical } from "./model-values.ts";
import {
  acceptLoadedComment,
  editLoadedComment,
  validateLoadedSnapshot,
} from "./comment-model.ts";
export function validateSnapshot(
  file: Pick<SharedFile, "sources">,
  snapshot: Snapshot | null,
  revision: string,
): Snapshot | null {
  return validateLoadedSnapshot(
    Object.hasOwn(file.sources, revision),
    snapshot,
    revision,
  );
}
function validateDraft(draft: CommentDraft) {
  text(draft.id, 100);
  text(draft.body);
  text(draft.sourceRevision, 100);
  if (draft.nodeId !== null && !isStableNodeId(draft.nodeId))
    fail(422, "Invalid comment anchor");
  if (draft.parentId !== null && typeof draft.parentId !== "string")
    fail(422, "Invalid reply parent");
}
export const localComment: CollaborationModel["localComment"] = (
  state,
  draft,
  snapshot,
  snapshotId,
  now = 0,
) => {
  validateDraft(draft);
  if (state.comments.some((c) => c.id === draft.id))
    fail(409, "Comment ID conflict");
  if (
    snapshot &&
    (!snapshotId || snapshot.sourceRevision !== draft.sourceRevision)
  )
    fail(422, "Snapshot source mismatch");
  const copy = snapshot ? (jsonCopy(snapshot) as Snapshot) : null;
  return {
    ...state,
    anchors: draft.nodeId
      ? { ...state.anchors, [draft.nodeId]: { quote: draft.quote } }
      : state.anchors,
    comments: [
      ...state.comments,
      {
        ...draft,
        appStateId: copy ? snapshotId : null,
        publishedBy: null,
        createdAt: new Date(now).toISOString(),
      },
    ],
    pending: [...state.pending, draft.id],
    snapshots:
      copy && snapshotId
        ? { ...state.snapshots, [snapshotId]: copy }
        : state.snapshots,
  };
};
export const acknowledge: CollaborationModel["acknowledge"] = (
  state,
  accepted,
  localId = accepted.id,
) => {
  const previous = state.comments.find((c) => c.id === localId);
  if (!previous) fail(409, "Acknowledgment has no local comment");
  if (
    localId !== accepted.id &&
    state.comments.some((c) => c.id === accepted.id)
  )
    fail(409, "Comment ID conflict");
  const snapshot = previous.appStateId
    ? state.snapshots[previous.appStateId]
    : null;
  // The server may not keep the local snapshot reference; the cached view stays usable.
  const appStateId = accepted.appStateId ?? previous.appStateId;
  return {
    ...state,
    comments: state.comments.map((c) =>
      c.id === localId && (c.revision ?? 0) <= accepted.revision
        ? { ...accepted, appStateId }
        : c.parentId === localId
          ? { ...c, parentId: accepted.id }
          : c,
    ),
    pending: state.pending.filter((id) => id !== localId),
    snapshots:
      accepted.appStateId && snapshot
        ? { ...state.snapshots, [accepted.appStateId]: snapshot }
        : state.snapshots,
  };
};
export const mergeComments: CollaborationModel["mergeComments"] = (
  state,
  remote,
) => {
  const comments = new Map(state.comments.map((c) => [c.id, c]));
  for (const c of remote)
    if (
      !state.pending.includes(c.id) &&
      (comments.get(c.id)?.revision ?? 0) <= c.revision
    )
      comments.set(c.id, { ...c });
  return { ...state, comments: [...comments.values()] };
};
export const compact: CollaborationModel["compact"] = (state, recent = 20) => {
  const acknowledged = state.comments.filter(
    (c) => !state.pending.includes(c.id),
  );
  const keep = new Set([
    ...state.pending,
    ...(recent > 0 ? acknowledged.slice(-recent) : []).map((c) => c.id),
  ]);
  // Keep parents of pending/recent replies, so a compacted file still has coherent threads.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of state.comments)
      if (keep.has(c.id) && c.parentId && !keep.has(c.parentId)) {
        keep.add(c.parentId);
        changed = true;
      }
  }
  const comments = state.comments.filter((c) => keep.has(c.id)),
    references = new Set(comments.map((c) => c.appStateId)),
    sourceReferences = new Set(comments.map((c) => c.sourceRevision)),
    anchorReferences = new Set(comments.map((c) => c.nodeId));
  return {
    ...state,
    comments,
    anchors: Object.fromEntries(
      Object.entries(state.anchors).filter(([id]) => anchorReferences.has(id)),
    ),
    sources: Object.fromEntries(
      Object.entries(state.sources || {}).filter(([id]) =>
        sourceReferences.has(id),
      ),
    ),
    snapshots: Object.fromEntries(
      Object.entries(state.snapshots).filter(([id]) => references.has(id)),
    ),
  };
};
export const acceptComment: CollaborationModel["acceptComment"] = (
  file,
  actor,
  draft,
  snapshot,
  options,
) => {
  const result = acceptLoadedComment(
    {
      sourceExists: Object.hasOwn(file.sources, draft.sourceRevision),
      parentExists:
        !!draft.parentId && Object.hasOwn(file.comments, draft.parentId),
      existing: Object.hasOwn(file.comments, draft.id)
        ? file.comments[draft.id]!
        : null,
      sequence: file.sequence,
    },
    actor,
    draft,
    snapshot,
    options,
  );
  if (!result.created) return { file, comment: result.comment, created: false };
  return {
    file: {
      ...file,
      sequence: result.comment.sequence,
      comments: { ...file.comments, [result.comment.id]: result.comment },
      snapshots: result.snapshot
        ? { ...file.snapshots, [result.snapshot.id]: result.snapshot.value }
        : file.snapshots,
    },
    comment: result.comment,
    created: true,
  };
};
export const editComment: CollaborationModel["editComment"] = (
  file,
  actor,
  owner,
  id,
  expected,
  edit,
) => {
  const comment = editLoadedComment(
    Object.hasOwn(file.comments, id) ? file.comments[id]! : null,
    actor,
    owner,
    expected,
    edit,
  );
  return {
    file: { ...file, comments: { ...file.comments, [id]: comment } },
    comment,
  };
};
export const presenceUpdate: CollaborationModel["presenceUpdate"] = (
  entries,
  actor,
  input,
  clock,
) => {
  if (!actor) fail(401, "Sign in to share presence");
  const sessionId = text(input.sessionId, 100);
  const old = Object.hasOwn(entries, sessionId) ? entries[sessionId] : null;
  if (old && old.actor !== actor)
    fail(403, "Session belongs to another viewer");
  const next = { ...entries };
  if (input.visible === false) {
    delete next[sessionId];
    return next;
  }
  const sourceRevision = text(input.sourceRevision, 100);
  const rawCursor = input.shareCursor === false ? null : (input.cursor ?? null);
  let cursor: import("./contracts.ts").Cursor | null = null;
  if (rawCursor) {
    if (
      typeof rawCursor !== "object" ||
      !("x" in rawCursor) ||
      !("y" in rawCursor) ||
      !("nodeId" in rawCursor) ||
      typeof rawCursor.x !== "number" ||
      typeof rawCursor.y !== "number" ||
      !Number.isFinite(rawCursor.x) ||
      !Number.isFinite(rawCursor.y) ||
      !isStableNodeId(rawCursor.nodeId) ||
      rawCursor.x < 0 ||
      rawCursor.x > 1 ||
      rawCursor.y < 0 ||
      rawCursor.y > 1
    )
      fail(422, "Invalid cursor");
    cursor = {
      ...rawCursor,
      x: rawCursor.x,
      y: rawCursor.y,
      nodeId: rawCursor.nodeId,
    };
  }
  next[sessionId] = {
    actor,
    sessionId,
    sourceRevision,
    cursor: cursor ? { ...cursor } : null,
    selection:
      input.shareSelection === false
        ? null
        : validateSelection(input.selection),
    snapshot:
      input.shareView === false
        ? null
        : input.snapshot
          ? (jsonCopy(input.snapshot) as Snapshot)
          : null,
    lastSeen: clock.now,
    generation: clock.generation,
  };
  return next;
};
function live(entry: PresenceEntry, clock: PresenceClock) {
  return (
    clock.now - entry.lastSeen < (clock.ttl ?? 30000) &&
    entry.generation === clock.generation
  );
}
export const visiblePresence: CollaborationModel["visiblePresence"] = (
  entries,
  clock,
) =>
  Object.values(entries)
    .filter((e) => live(e, clock))
    .map((e) => ({
      actor: e.actor,
      sessionId: e.sessionId,
      sourceRevision: e.sourceRevision,
      cursor: e.cursor ? { ...e.cursor } : null,
      selection: validateSelection(e.selection),
      shareView: !!e.snapshot,
    }));
export const capturePresence: CollaborationModel["capturePresence"] = (
  entries,
  id,
  clock,
) => {
  const entry = Object.hasOwn(entries, id) ? entries[id] : null;
  if (!entry || !live(entry, clock)) fail(410, "Viewer left");
  if (!entry.snapshot) fail(403, "This viewer is not sharing their view");
  return jsonCopy(entry.snapshot) as Snapshot;
};
export const enterView: CollaborationModel["enterView"] = (
  session,
  snapshot,
) => ({
  current: snapshot ? (jsonCopy(snapshot) as Snapshot) : null,
  own: session.own ?? {
    snapshot: session.current ? (jsonCopy(session.current) as Snapshot) : null,
  },
});
export const leaveView: CollaborationModel["leaveView"] = (session) => ({
  current: session.own ? session.own.snapshot : session.current,
  own: null,
});
export const replaceSource: CollaborationModel["replaceSource"] = (
  state,
  previousSource,
  revision,
) => ({
  ...state,
  sourceRevision: revision,
  app: null,
  sources: { ...state.sources, [state.sourceRevision]: previousSource },
});

export const createPublication: import("./contracts.js").PublicationModel["createPublication"] =
  (state, actor, request, options) => {
    const key = actor + ":" + request.requestId;
    const result = preparePublication(
      Object.hasOwn(state.publications, key) ? state.publications[key]! : null,
      actor,
      request,
      options,
    );
    return {
      state: result.file
        ? {
            ...state,
            files: { ...state.files, [options.fileId]: result.file },
            publications: { ...state.publications, [key]: result.publication },
          }
        : state,
      publication: result.publication,
      created: result.created,
    };
  };
