import type { AnnotationCommentWire } from "../annotations";
import { remoteSessions, RemoteError, type RemoteRegistry } from "./registry";
/** Explicit session links are stable mentions. A bare @claude never picks an arbitrary machine. */
export function notifyRemoteComment(
  userId: string | null | undefined,
  artifactId: string,
  annotationId: string,
  comment: AnnotationCommentWire,
  registry: RemoteRegistry = remoteSessions,
): void {
  if (!userId || comment.author.kind !== "human") return;
  const targets = new Set(
    [
      ...comment.body.matchAll(
        /\[@[^\]\n]+\]\(\/chat\?session=([a-f0-9-]{36})\)/g,
      ),
    ].map((m) => m[1]),
  );
  const data =
    JSON.stringify({
      type: "artifactbin.comment",
      artifact_id: artifactId,
      annotation_id: annotationId,
      comment_id: comment.id,
      author: comment.author.label,
      body: comment.body,
      instruction:
        "A user mentioned this session. Read the artifact and comment, then respond using your artifactbin plugin, MCP, or API.",
    }) + "\r";
  for (const id of targets) {
    try {
      registry.input(userId, id, data, "comment", comment.id);
    } catch (error) {
      if (!(error instanceof RemoteError))
        throw error; /* A disconnected agent must not prevent saving the comment. */
    }
  }
}
