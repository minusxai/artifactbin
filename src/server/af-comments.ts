/**
 * Comments over the v2 HTTP API, on the existing comment repository and model.
 * The server chooses comment IDs; a comment keeps the page version and the
 * page state its author saw, which GET …/context returns.
 */
import { randomUUID } from "node:crypto";
import type { AfJsonObject } from "../af-contracts.ts";
import type {
  CommentRecord,
  CommentsResponse,
  ContextResponse,
} from "./af-api-contracts.ts";
import type { AcceptedComment, Capture, Json, PresenceEntry, Snapshot } from "../contracts.ts";
import type { CommentRepository, CommentAccess } from "./comment-repository-contracts.ts";
import { acceptLoadedComment, editLoadedComment } from "../comment-model.ts";
import { capturePresence } from "../model.ts";
import { canonical } from "../model-values.ts";
import { authorizeDocument } from "./document-authorization.ts";
import { fileAddress, isFileId } from "../ids/file-id.ts";
import { stateUrl } from "../apollo/state-url.ts";
import { fail } from "../errors.ts";
import { hash } from "./text.ts";
import { PAGE_STATE_SCHEMA } from "./page-ports.ts";
import { decodeCursor, encodeCursor } from "./idempotency.ts";

export function commentRecord(comment: AcceptedComment): CommentRecord {
  return {
    id: comment.id,
    nodeId: comment.context?.status === "unavailable" ? null : comment.nodeId,
    quote: comment.quote,
    body: comment.body,
    parentId: comment.parentId,
    version: comment.sourceRevision === null ? null : Number(comment.sourceRevision),
    ...(comment.context ? { context: comment.context } : {}),
    author: comment.publishedBy,
    createdAt: comment.createdAt,
    revision: comment.revision,
    resolved: comment.resolved,
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createCommentService({
  comments,
  now = Date.now,
}: {
  comments: CommentRepository;
  now?: () => number;
}) {
  function request(fileId: string, credential: string) {
    if (!isFileId(fileId)) fail(404, "File not found");
    return { fileId, tokenHash: hash(credential) };
  }
  function authorize(fileId: string, credential: string, context: CommentAccess) {
    return authorizeDocument({
      ...context,
      credentialHash: credential ? hash(credential) : null,
      fileId,
      now: now(),
    });
  }
  function commenter(fileId: string, credential: string, context: CommentAccess) {
    const decision = authorize(fileId, credential, context);
    if (!decision.permissions.comment || !decision.actor)
      fail(403, "You have view-only access. Ask for permission to comment.");
    return decision;
  }
  return {
    /** GET …/comments, or with `since` (an opaque cursor) only what changed after it. */
    list(fileId: string, credential: string, since: string | null = null): Promise<CommentsResponse> {
      const base = request(fileId, credential);
      const after = decodeCursor(since);
      return comments.list(
        base,
        (context) => {
          authorize(fileId, credential, context);
          return {
            comments: context.comments.map(commentRecord),
            head: Number(context.document!.head),
            cursor: encodeCursor(context.cursor),
          };
        },
        after,
      );
    },

    /**
     * POST …/comments (comments and replies). With an Idempotency-Key, the
     * first created comment is stored with it and a repeat returns it.
     */
    async add(
      fileId: string,
      credential: string,
      body: Record<string, unknown>,
      key: string | null = null,
    ): Promise<CommentRecord> {
      // Validated after authorization, so a viewer learns only that they cannot comment.
      const parse = () => {
        const input = body.comment;
        if (!object(input)) fail(422, "Send { comment: { nodeId, quote, body } }");
        if (input.nodeId !== null && (typeof input.nodeId !== "string" || !input.nodeId || input.nodeId.length > 200))
          fail(422, "comment.nodeId must be a data-af-id or null");
        if (typeof input.body !== "string" || !input.body.trim() || input.body.length > 10000)
          fail(422, "comment.body must be text");
        if (input.quote !== undefined && typeof input.quote !== "string")
          fail(422, "comment.quote must be text");
        const parentId = input.parentId ?? null;
        if (parentId !== null && (typeof parentId !== "string" || parentId.length > 100))
          fail(422, "comment.parentId must be a comment ID");
        if (
          input.version !== undefined &&
          (typeof input.version !== "number" || !Number.isSafeInteger(input.version) || input.version < 1)
        )
          fail(422, "comment.version must be a page version");
        const state = input.state ?? null;
        if (state !== null && !object(state)) fail(422, "comment.state must be an object");
        // The platform UI also sends the inert view it captured (scripts and attributes stripped).
        const rendered = input.rendered ?? null;
        if (rendered !== null && (typeof rendered !== "string" || rendered.length > 200000))
          fail(422, "comment.rendered must be text");
        return { input, parentId: parentId as string | null, state, rendered: rendered as string | null };
      };
      let parsed: ReturnType<typeof parse>;
      const id = randomUUID();
      const comment = await comments.add(
        request(fileId, credential),
        (context) => {
          const { actor } = commenter(fileId, credential, context);
          parsed = parse();
          return {
            commentId: id,
            parentId: parsed.parentId,
            sourceRevision: String(parsed.input.version ?? Number(context.document!.head)),
            actor: actor!,
          };
        },
        (context) => {
          const { actor } = commenter(fileId, credential, context);
          const { input, parentId, state, rendered } = parsed;
          const sourceRevision = String(input.version ?? Number(context.document!.head));
          if (!context.sourceExists) fail(422, "comment.version is not a version of this page");
          const snapshot: Snapshot | null =
            state || rendered
              ? {
                  schema: PAGE_STATE_SCHEMA,
                  sourceRevision,
                  state: (state ?? {}) as Snapshot["state"],
                  view: { x: 0, y: 0 },
                  ...(rendered ? { rendered } : {}),
                }
              : null;
          const accepted = acceptLoadedComment(
            { ...context, sequence: context.document!.sequence },
            actor!,
            {
              id,
              nodeId: input.nodeId as string | null,
              quote: (input.quote as string | undefined) ?? "",
              body: input.body as string,
              sourceRevision,
              parentId,
            },
            snapshot,
            { digest: hash, now: now() },
          );
          return {
            value: commentRecord(accepted.comment),
            insert: { comment: accepted.comment, snapshot: accepted.snapshot },
          };
        },
        key === null
          ? null
          : {
              key,
              fingerprint: hash(canonical(["comment", (body.comment ?? null) as Json])),
              now: now(),
            },
      );
      return comment;
    },

    async edit(
      fileId: string,
      credential: string,
      commentId: string,
      ifMatch: string | undefined,
      change: Record<string, unknown>,
    ): Promise<CommentRecord> {
      const expected = Number(String(ifMatch ?? "").trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1"));
      if (!ifMatch || !Number.isSafeInteger(expected))
        fail(428, "Send If-Match with the comment's revision");
      if (change.body !== undefined && (typeof change.body !== "string" || !change.body.trim()))
        fail(422, "body must be text");
      if (change.resolved !== undefined && typeof change.resolved !== "boolean")
        fail(422, "resolved must be true or false");
      const edited = await comments.edit(
        request(fileId, credential),
        (context) => {
          commenter(fileId, credential, context);
          return { commentId };
        },
        (context) => {
          const { actor, owner } = commenter(fileId, credential, context);
          const comment = editLoadedComment(context.comment, actor!, owner, expected, {
            ...(change.body !== undefined ? { body: change.body as string } : {}),
            ...(change.resolved !== undefined ? { resolved: change.resolved as boolean } : {}),
          });
          return { value: comment, comment };
        },
      );
      return commentRecord(edited);
    },

    context(fileId: string, credential: string, commentId: string, origin: string): Promise<ContextResponse> {
      return comments.context(
        request(fileId, credential),
        (context) => {
          authorize(fileId, credential, context);
          return { commentId };
        },
        (context) => {
          authorize(fileId, credential, context);
          const comment = context.comment ?? fail(404, "Comment not found");
          if (comment.context?.status === "unavailable")
            return { comment: commentRecord(comment), context: comment.context, source: null, state: null, url: null };
          const source = context.source ?? fail(404, "Source unavailable");
          const state = (context.snapshot?.state as AfJsonObject | undefined) ?? null;
          const address = fileAddress(origin, fileId);
          let url = address;
          try {
            if (state) url = stateUrl(address, state);
          } catch {
            /* Too large for a URL: the plain address, with the state in `state`. */
          }
          return {
            comment: commentRecord(comment),
            source: source.content,
            state,
            ...(context.snapshot?.rendered ? { rendered: context.snapshot.rendered } : {}),
            url,
          };
        },
      );
    },

    /**
     * POST /api/files/:id/capture (platform UI only): what another viewer
     * currently shares, from live presence, to show read-only.
     */
    capture(
      fileId: string,
      credential: string,
      sessionId: unknown,
      entries: Record<string, PresenceEntry>,
    ): Promise<Capture> {
      if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100)
        fail(422, "Send { sessionId }");
      let shared: Snapshot;
      return comments.capture(
        request(fileId, credential),
        (context) => {
          authorize(fileId, credential, context);
          const document = context.document!;
          shared = capturePresence(entries, sessionId, {
            now: now(),
            generation: document.generation,
          });
          if (document.sourceDigest && shared.sourceRevision !== document.sourceDigest)
            fail(409, "This viewer has another version of the page open");
          // Stored against the numbered version, which is how sources are kept.
          return { ...shared, sourceRevision: String(document.head) };
        },
        (context) => {
          const source = context.source ?? fail(409, "The page changed; try again");
          const appStateId = hash(canonical(context.snapshot as unknown as Json));
          return {
            value: { appStateId, snapshot: shared, source: source.content },
            snapshot: { id: appStateId, value: context.snapshot },
          };
        },
      );
    },
  };
}
