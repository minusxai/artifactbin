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
export function parseCommentTarget(_value: unknown): CommentTarget | null {
  throw new Error('comment-target: implement');
}

/** Runtime metadata only; never serialized back to authored source. */
export const COMMENT_TARGET_ATTR = 'data-mx-comment-target';
export const COMMENT_OWNER_ATTR = 'data-mx-comment-owner';
