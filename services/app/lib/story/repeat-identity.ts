import type { CommentKey, CommentTarget } from './comment-target';
import { COMMENT_OWNER_ATTR, COMMENT_TARGET_ATTR, isCommentKey, parseCommentTarget } from './comment-target';

export function validRowKey(value: unknown): value is CommentKey {
  return isCommentKey(value);
}
export function keyedRowsError(rows: Record<string, unknown>[], field: string, label = 'rowKey'): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = Object.hasOwn(row, field) ? row[field] : undefined;
    if (!validRowKey(value)) return `${label} must have a non-null string (at most 256 characters, without control characters) or finite number for every row`;
    const key = JSON.stringify([typeof value, value]);
    if (seen.has(key)) return `${label} must be unique; duplicate key ${String(value)}`;
    seen.add(key);
  }
  return null;
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
