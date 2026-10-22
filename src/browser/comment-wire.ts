/**
 * The one mapping between the platform UI's collaboration operations and the
 * v2 HTTP API (skills/pagegi-author/references/http-api.md), shared by the
 * hosted transport and the platform frame.
 *
 * The UI keys a page version by its source digest; the server numbers
 * versions. `PageVersion` relates the two for the page that is open: the
 * open version maps to its digest, any other version to its number as text.
 */
import type {
  AcceptedComment,
  Capture,
  Comment,
  CommentsResponse,
  Context,
  Snapshot,
} from "../contracts.ts";
import type {
  CommentInput,
  CommentRecord,
  ContextResponse,
} from "../server/af-api-contracts.ts";
import type { PlatformOperation } from "./platform-contracts.ts";

export interface PageVersion {
  /** The server's version number of the open page, when known. */
  version: number | null;
  /** The UI's revision key for the open page. */
  revision: string;
}
export interface WireRequest {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The UI revision key for a server version. */
export function revisionOf(version: number, page: PageVersion): string {
  return page.version === version ? page.revision : String(version);
}
/** The server version for a UI revision key; undefined lets the server use its head. */
export function versionOf(
  revision: string | null,
  page: PageVersion,
): number | undefined {
  if (revision === null) return undefined;
  if (revision === page.revision && page.version !== null) return page.version;
  return /^[1-9]\d{0,14}$/.test(revision) ? Number(revision) : undefined;
}

/** A comment as the UI keeps it, from the server's record. */
export function acceptedComment(
  record: CommentRecord,
  page: PageVersion,
): AcceptedComment {
  return {
    id: record.id,
    nodeId: record.context?.status === "unavailable" ? null : record.nodeId,
    quote: record.quote,
    body: record.body,
    ...(record.attachments?.length ? { attachments: record.attachments } : {}),
    parentId: record.parentId,
    sourceRevision: record.version === null ? null : revisionOf(record.version, page),
    ...(record.context ? { context: record.context } : {}),
    ...(record.stateReplay ? {stateReplay:record.stateReplay}:{}),
    appStateId: null,
    publishedBy: record.author,
    createdAt: record.createdAt,
    revision: record.revision,
    resolved: record.resolved,
    fingerprint: "",
    sequence: 0,
  };
}

/** The POST …/comments body for a comment written in the UI. */
export function commentInput(
  comment: Comment,
  snapshot: Snapshot | null,
  page: PageVersion,
): { comment: CommentInput & { rendered?: string } } {
  const version = versionOf(comment.sourceRevision, page);
  return {
    comment: {
      nodeId: comment.nodeId,
      quote: comment.quote,
      body: comment.body,
      parentId: comment.parentId,
      ...(version === undefined ? {} : { version }),
      ...(snapshot ? { state: snapshot.state } : {}),
      ...(snapshot?.rendered ? { rendered: snapshot.rendered } : {}),
    },
  };
}

export function wireRequest(
  op: PlatformOperation,
  page: PageVersion,
): WireRequest {
  switch (op.kind) {
    case "permissions":
      return { path: "/permissions" };
    case "comments.list":
      return { path: "/comments" };
    case "comments.create":
      return {
        path: "/comments",
        method: "POST",
        body: commentInput(
          op.comment as Comment,
          (op.snapshot as Snapshot | null) ?? null,
          page,
        ),
      };
    case "comments.resolve":
      return {
        path: "/comments/" + encodeURIComponent(op.id),
        method: "PUT",
        body: { resolved: op.resolved ?? true },
        headers: { "If-Match": String(op.revision) },
      };
    case "context.get":
      return { path: "/context/" + encodeURIComponent(op.id) };
    case "profiles.list":
      return { path: "/profiles" };
    case "presence.capture":
      return {
        path: "/capture",
        method: "POST",
        body: { sessionId: op.sessionId },
      };
  }
}

/** The UI's result for a server response to `op`. */
export function wireResult(
  op: PlatformOperation,
  value: any,
  page: PageVersion,
): unknown {
  switch (op.kind) {
    case "comments.list":
      return {
        comments: (value.comments as CommentRecord[]).map((record) =>
          acceptedComment(record, page),
        ),
        head: revisionOf(Number(value.head), page),
      } satisfies CommentsResponse;
    case "comments.create":
    case "comments.resolve":
      return acceptedComment(value as CommentRecord, page);
    case "context.get": {
      const context = value as ContextResponse & { rendered?: string };
      const comment = acceptedComment(context.comment, page);
      const snapshot: Snapshot | null =
        comment.sourceRevision && (context.state || context.rendered)
          ? {
              schema: 0,
              sourceRevision: comment.sourceRevision,
              state: context.state ?? {},
              view: { x: 0, y: 0 },
              ...(context.rendered ? { rendered: context.rendered } : {}),
            }
          : null;
      return { comment, source: context.source, snapshot } satisfies Context;
    }
    case "presence.capture":
      return value as Capture;
    default:
      return value;
  }
}
