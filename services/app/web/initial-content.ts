/** First useful page commit, independent of identity and background insights. */
let ready = false;
const listeners = new Set<() => void>();
export function markInitialContentReady(): void {
  if (ready) return;
  ready = true;
  for (const notify of listeners) notify();
  listeners.clear();
}
export function onInitialContentReady(notify: () => void): () => void {
  if (ready) notify(); else listeners.add(notify);
  return () => { listeners.delete(notify); };
}
