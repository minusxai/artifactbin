/** One compiled document's hydration boundary, never a platform/browser global. */
export interface CompiledReadiness {
  defer(start: () => void): () => void;
  ready(): void;
}
export interface ReadinessClock {
  schedule(start: () => void): () => void;
}
