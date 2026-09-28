import type { CommentKey, CommentTarget } from './comment-target';
import { COMMENT_OWNER_ATTR, COMMENT_TARGET_ATTR, parseCommentTarget } from './comment-target';
import { isCommentKey } from './row-key';
export { keyedRowsError } from './row-key';

export function validRowKey(value: unknown): value is CommentKey {
  return isCommentKey(value);
}
export function commentMetadata(owner: string | undefined, target: CommentTarget): Record<string, string> {
  if (!owner) return {};
  const canonical = parseCommentTarget(target);
  return { [COMMENT_OWNER_ATTR]: owner, ...(canonical ? { [COMMENT_TARGET_ATTR]: JSON.stringify(canonical) } : {}) };
}
/** Injective encoding; authored IDs and typed keys remain independent of list position. */
export function instanceDomId(scope: unknown, sourceId: string): string {
  return `mx-instance-${encodeURIComponent(JSON.stringify([scope, sourceId]))}`;
}
