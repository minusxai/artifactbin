import { parseCommentViewState, type CommentViewState, type ReviewJson } from '../../../contracts/src/comment-view-state';

/** Register UI/mock state only. Restore is synchronous and must not replay actions or perform writes. */
export interface ReviewStateRegistration { id: string; get(): ReviewJson; restore(value: ReviewJson): void }
export interface ReviewStateRegistry {
  register(part: ReviewStateRegistration): () => void;
  capture(): CommentViewState | null;
  restore(snapshot: CommentViewState): void;
}

// The frame editor is built separately from the author runtime. A module-local WeakMap would create
// TWO registries. This symbol shares only document-local callbacks, never the trusted parent bridge.
const REGISTRY = Symbol.for('artifactbin.review-state.v1');
export function reviewStateFor(owner: object): ReviewStateRegistry {
  const realm = owner as { [REGISTRY]?: ReviewStateRegistry };
  if (realm[REGISTRY]) return realm[REGISTRY];
  const parts = new Map<string, ReviewStateRegistration>();
  const capture = (): CommentViewState | null => {
    if (!parts.size) return null;
    const snapshot = parseCommentViewState({ v: 1, components: Object.fromEntries([...parts].map(([id, part]) => [id, part.get()])) });
    if (!snapshot) throw new Error('Review state must be bounded JSON data.');
    return snapshot;
  };
  const registry: ReviewStateRegistry = {
    register(part) {
      if (!part || typeof part.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(part.id) || typeof part.get !== 'function' || typeof part.restore !== 'function') throw new Error('reviewState needs a stable id, get, and restore.');
      if (parts.has(part.id)) throw new Error('Review state already registered: ' + part.id);
      parts.set(part.id, part);
      return () => { if (parts.get(part.id) === part) parts.delete(part.id); };
    },
    capture,
    restore(input) {
      const saved = parseCommentViewState(input);
      if (!saved) throw new Error('Invalid saved view.');
      const ids = Object.keys(saved.components);
      if (ids.length !== parts.size || ids.some(id => !parts.has(id))) throw new Error('This app has changed; its saved view cannot be restored.');
      const before = capture();
      try { for (const [id, part] of parts) part.restore(saved.components[id]!); }
      catch (error) {
        // Best effort rollback: a custom adapter may reject a state from an older app revision.
        if (before) for (const [id, part] of parts) { try { part.restore(before.components[id]!); } catch { /* report the original restore failure */ } }
        throw error;
      }
    },
  };
  Object.defineProperty(realm, REGISTRY, { value: registry });
  return registry;
}

/** Freeze context at the selection gesture, before the composer changes focus. */
export function withReviewState<T extends object>(doc: Document, selection: T): T & { viewState?: CommentViewState; viewStateError?: string } {
  try { const viewState = reviewStateFor(doc).capture(); return viewState ? { ...selection, viewState } : selection; }
  catch { return { ...selection, viewStateError: 'This view could not be saved. The comment will remember its target only.' }; }
}
