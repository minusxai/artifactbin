import type { Comment } from "../contracts.ts";
import type {
  CommentLinkController,
  CommentLinkOptions,
} from "./comment-link-contracts.ts";
export function parseCommentLink(search: URLSearchParams): string | null {
  const values = [...search.getAll("comment"), ...search.getAll("thread")];
  if (!values.length) return null;
  const id = values[0]!;
  if (
    values.length !== 1 ||
    !id ||
    id.length > 512 ||
    /[\s\u0000-\u001f\u007f]/.test(id)
  )
    throw Error("Invalid comment link");
  return id;
}
/** A link always resolves against fresh authority, never the initial comment cache. */
export function createCommentLink(
  options: CommentLinkOptions,
): CommentLinkController {
  let generation = 0,
    disposed = false,
    pending: AbortController | null = null;
  const invalidate = () => {
    generation++;
    pending?.abort();
    pending = null;
  };
  return {
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
    async open(search) {
      invalidate();
      if (disposed) return;
      const own = generation,
        controller = new AbortController();
      pending = controller;
      const current = () =>
        !disposed && own === generation && !controller.signal.aborted;
      try {
        const id = parseCommentLink(search);
        if (!id) return;
        const thread = await options.readThread(id, controller.signal);
        if (!current()) return;
        const selected = thread.comments.find((c) => c.id === id),
          root = thread.comments.find((c) => c.id === thread.rootId);
        if (
          thread.selectedId !== id ||
          !selected ||
          !root ||
          root.parentId !== null
        )
          throw Error("Comment thread unavailable");
        options.install(thread);
        if (!current()) return;
        // Select the thread immediately; a missing saved context remains an explicit notice.
        options.openThread(root.id, selected.id);
        if (!current()) return;
        await options.showComment(selected);
      } catch (error) {
        if (current())
          options.error(
            error instanceof Error ? error.message : "Comment unavailable",
          );
      } finally {
        if (pending === controller) pending = null;
      }
    },
  };
}

/** Preserve stored order while including nested replies; unrelated or cyclic orphan threads stay out. */
export function commentThreadReplies(
  comments: readonly Comment[],
  rootId: string,
): Comment[] {
  const children = new Map<string, string[]>();
  for (const comment of comments) {
    if (comment.parentId) {
      const list = children.get(comment.parentId) || [];
      list.push(comment.id);
      children.set(comment.parentId, list);
    }
  }
  const included = new Set([rootId]),
    queue = [rootId];
  for (let index = 0; index < queue.length; index++)
    for (const id of children.get(queue[index]!) || []) {
      if (!included.has(id)) {
        included.add(id);
        queue.push(id);
      }
    }
  return comments.filter(
    (comment) => comment.id !== rootId && included.has(comment.id),
  );
}
