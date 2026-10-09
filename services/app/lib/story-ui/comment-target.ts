/** Persistent refinements scoped to the annotation's independently validated source owner. */
import { isCommentKey, type CommentKey } from './row-key';
export type { CommentKey } from './row-key';
export type CommentTarget =
  | { kind: 'table'; rowKey: CommentKey; columnKey?: string; templateNodeId?: string }
  | { kind: 'repeat'; scopes: Array<{ nodeId: string; key: CommentKey }>; templateNodeId: string };

/** Strict, bounded canonicalization at every incoming message and persistence boundary. */
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const only = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every((name) => names.includes(name));
export function parseCommentTarget(value: unknown): CommentTarget | null {
  if (!record(value)) return null;
  if (value.kind === 'table' && only(value, ['kind', 'rowKey', 'columnKey', 'templateNodeId']) && isCommentKey(value.rowKey)) {
    if (value.columnKey !== undefined && !identity(value.columnKey) || value.templateNodeId !== undefined && !identity(value.templateNodeId)) return null;
    return { kind: 'table', rowKey: value.rowKey, ...(value.columnKey !== undefined ? {columnKey: value.columnKey as string} : {}), ...(value.templateNodeId !== undefined ? {templateNodeId: value.templateNodeId as string} : {}) };
  }
  if (value.kind === 'repeat' && only(value, ['kind', 'scopes', 'templateNodeId']) && identity(value.templateNodeId) && Array.isArray(value.scopes) && value.scopes.length > 0 && value.scopes.length <= 16) {
    const scopes: Array<{nodeId: string; key: CommentKey}> = [];
    for (const scope of value.scopes) {
      if (!record(scope) || !only(scope, ['nodeId', 'key']) || !identity(scope.nodeId) || !isCommentKey(scope.key) || scopes.some((s) => s.nodeId === scope.nodeId)) return null;
      scopes.push({ nodeId: scope.nodeId, key: scope.key });
    }
    return {kind: 'repeat', scopes, templateNodeId: value.templateNodeId};
  }
  return null;
}

/** Runtime metadata only; never serialized back to authored source. */
export const COMMENT_TARGET_ATTR = 'data-mx-comment-target';
export const COMMENT_OWNER_ATTR = 'data-mx-comment-owner';
