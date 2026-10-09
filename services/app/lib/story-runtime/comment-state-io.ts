/** Capture and restore over the comment state slot (./comment-state): the frame editor's and page runtime's half, kept out of kit chunks. */
import type { CommentViewState, ReviewJson } from '../../../contracts/src/comment-view-state';
import { commentStateSlot } from './comment-state';

/** A part owns what it is handed: no object is shared between the pending snapshot and live state. */
const copy = <T extends ReviewJson>(value: T): T => (value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) as T : value);

/** The value the last restore holds for a key, registered or not. */
export const pendingCommentState = (owner: object, key: string): ReviewJson | undefined => {
  const { pending } = commentStateSlot(owner);
  return Object.hasOwn(pending, key) ? copy(pending[key]!) : undefined;
};

/** Runs a restore's sets together; the page runtime installs Solid's batch. */
export function setCommentStateTransaction(owner: object, transaction: (run: () => void) => void): void { commentStateSlot(owner).transaction = transaction; }

/** Plain JSON data only: no functions, class instances, cycles or non-finite numbers. Size and depth limits are the contract's. */
const plain = (value: unknown, depth = 0): value is ReviewJson => {
  if (depth > 16) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => plain(item, depth + 1));
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((item) => plain(item, depth + 1));
};

/** Every registered part's current value as plain JSON, copied; a part whose value is not (a function, a DOM node, a Date) is skipped. null when nothing is registered. */
export function captureCommentState(owner: object): CommentViewState | null {
  const { parts } = commentStateSlot(owner);
  if (!parts.size) return null;
  const state: Record<string, ReviewJson> = {};
  for (const [key, part] of parts) {
    const value = part.get();
    if (!plain(value)) { console.warn(`[comments] state "${key}" is not plain JSON and was not saved`); continue; }
    state[key] = JSON.parse(JSON.stringify(value)) as ReviewJson;
  }
  return { v: 2, state };
}

/** Set every live part a validated snapshot names, each from its own copy; the snapshot stays pending for parts registered later. Throws when a part refuses its value. */
export function restoreCommentState(owner: object, saved: CommentViewState): void {
  const slot = commentStateSlot(owner);
  const state = JSON.parse(JSON.stringify(saved.state)) as Record<string, ReviewJson>;
  slot.pending = state;
  const refused: string[] = [];
  slot.transaction(() => {
    for (const [key, value] of Object.entries(state)) {
      const part = slot.parts.get(key);
      if (!part) continue;
      try { part.set(copy(value)); } catch { refused.push(key); }
    }
  });
  if (refused.length) throw new Error(`Saved state could not be restored: ${refused.join(', ')}`);
}
