/**
 * COMMENTABLE STATE: what a native comment saves beside its target and puts back when the thread opens.
 *
 * Every piece registers under a stable key — the declared Values as one `$` group (lib/islands/page-runtime), a kit
 * element's view state under its node id, a script's `createSignal(value, {name})` under its mount's node id
 * (lib/islands/comment-state). Nothing is opted in by hand: a key that exists is captured. A restore sets what is
 * live and stays PENDING, so a screen the restore mounts reads its own value as it registers; keys the page no
 * longer has are ignored, never refused. Restore is synchronous and must not replay actions or perform writes.
 *
 * Plain functions over one document-local slot. esbuild splits chunks by file, so this file holds only what a kit
 * chunk needs (register, pending); capture and restore live in ./comment-state-io, loaded by the frame editor and
 * the page runtime. The bounded-JSON contract (contracts comment-view-state) is applied by the frame editor.
 */
import type { ReviewJson } from '../../../contracts/src/comment-view-state';

/** One piece of commentable state: read now, write synchronously. */
export interface CommentStatePart { get(): unknown; set(value: ReviewJson): void }
export interface CommentStateSlot { parts: Map<string, CommentStatePart>; pending: Record<string, ReviewJson>; transaction: (run: () => void) => void }

// The frame editor, the page runtime and the kit are built separately. A module-local WeakMap would create
// several slots. This symbol shares only document-local callbacks, never the trusted parent bridge.
const SLOT = Symbol.for('artifactbin.comment-state.v2');
const KEY = /^[^\s]{1,128}$/;
/** A part owns what it is handed: no object is shared between the pending snapshot and live state. */
export const copy = <T extends ReviewJson>(value: T): T => (value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) as T : value);

/** @internal The document's slot, for comment-state-io. */
export function commentStateSlot(owner: object): CommentStateSlot {
  const realm = owner as { [SLOT]?: CommentStateSlot };
  if (!realm[SLOT]) Object.defineProperty(realm, SLOT, { value: { parts: new Map(), pending: {}, transaction: (run: () => void) => run() } });
  return realm[SLOT]!;
}

/** Register under a stable key. A live duplicate is replaced (last wins) with a console warning; a value the last restore holds for the key is applied at once. */
export function registerCommentState(owner: object, key: string, part: CommentStatePart): () => void {
  if (typeof key !== 'string' || !KEY.test(key) || typeof part?.get !== 'function' || typeof part.set !== 'function') throw new Error('Comment state needs a stable key, get, and set.');
  const { parts, pending } = commentStateSlot(owner);
  if (parts.has(key)) console.warn(`[comments] state "${key}" is registered twice; the last registration wins. Give each element its own id.`);
  parts.set(key, part);
  if (Object.hasOwn(pending, key)) { try { part.set(copy(pending[key]!)); } catch (error) { console.warn(`[comments] state "${key}" refused its saved value`, error); } }
  return () => { if (parts.get(key) === part) parts.delete(key); };
}

/** The value the last restore holds for a key, registered or not. */
export const pendingCommentState = (owner: object, key: string): ReviewJson | undefined => {
  const { pending } = commentStateSlot(owner);
  return Object.hasOwn(pending, key) ? copy(pending[key]!) : undefined;
};

/** Forget the last restore: nothing registered later takes its values. */
export function clearPendingCommentState(owner: object): void { commentStateSlot(owner).pending = {}; }

/** Runs a restore's sets together; the page runtime installs Solid's batch. */
export function setCommentStateTransaction(owner: object, transaction: (run: () => void) => void): void { commentStateSlot(owner).transaction = transaction; }
