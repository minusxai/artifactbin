/** Persistent refinements scoped to the annotation's independently validated source owner. */
export type CommentKey = string | number;
export type IframeNodeTarget =
  | { kind: 'source'; id: string }
  | { kind: 'key'; path: string[] }
  | { kind: 'session'; generation: string; id: string };
export type CommentTarget =
  | { kind: 'iframe'; node: IframeNodeTarget }
  | { kind: 'table'; rowKey: CommentKey; columnKey?: string; templateNodeId?: string }
  | { kind: 'repeat'; scopes: Array<{ nodeId: string; key: CommentKey }>; templateNodeId: string };

/** Strict, bounded canonicalization at every incoming message and persistence boundary. */
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
export const isCommentKey = (value: unknown): value is CommentKey => (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f]/.test(value)) || (typeof value === 'number' && Number.isFinite(value));
const only = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every((name) => names.includes(name));
export function parseCommentTarget(value: unknown): CommentTarget | null {
  if (!record(value)) return null;
  if (value.kind === 'iframe' && only(value, ['kind', 'node']) && record(value.node)) {
    const node = value.node;
    if (node.kind === 'source' && only(node, ['kind', 'id']) && identity(node.id)) return { kind: 'iframe', node: { kind: 'source', id: node.id } };
    if (node.kind === 'session' && only(node, ['kind', 'id', 'generation']) && identity(node.id) && identity(node.generation)) return { kind: 'iframe', node: { kind: 'session', id: node.id, generation: node.generation } };
    if (node.kind === 'key' && only(node, ['kind', 'path']) && Array.isArray(node.path) && node.path.length > 0 && node.path.length <= 16 && node.path.every(identity)) return { kind: 'iframe', node: { kind: 'key', path: [...node.path] } };
  }
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
