/** Optional, inert UI context beside a comment's existing source/text target.
 * Captured from the document's comment state registry (lib/story-runtime/comment-state): `$` holds the declared
 * Values the link carries, as one object; every other key is a named signal — `<node id>:<name>` inside a mounted
 * component or a kit element, the bare name at module level. Credentials and private drafts do not belong here. */
export type ReviewJson = null | boolean | number | string | ReviewJson[] | { [key: string]: ReviewJson };
export interface CommentViewState { v: 2; state: Record<string, ReviewJson> }
export const COMMENT_VIEW_STATE_MAX_BYTES = 32768;
export const COMMENT_VIEW_STATE_MAX_KEYS = 256;
/** The key the declared Values travel under, as one `{name: value}` object. */
export const COMMENT_VALUES_KEY = '$';

/** Bounded JSON only, shared by capture, persistence, and restoration. */
export function parseCommentViewState(input: unknown): CommentViewState | null {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const safeKey = (key: string) => key.length > 0 && key.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(key);
  let budget = 4096;
  const valid = (value: unknown, depth: number): boolean => {
    if (--budget < 0 || depth > 16) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => valid(item, depth + 1));
    return object(value) && Object.getPrototypeOf(value) === Object.prototype && Object.entries(value).every(([key, item]) => safeKey(key) && valid(item, depth + 1));
  };
  try {
    if (!object(input) || input.v !== 2 || Object.keys(input).some(key => !['v', 'state'].includes(key)) || !object(input.state)) return null;
    if (Object.keys(input.state).length > COMMENT_VIEW_STATE_MAX_KEYS || !valid(input.state, 0)) return null;
    const encoded = JSON.stringify(input);
    if (new TextEncoder().encode(encoded).length > COMMENT_VIEW_STATE_MAX_BYTES) return null;
    return JSON.parse(encoded) as CommentViewState;
  } catch { return null; }
}
