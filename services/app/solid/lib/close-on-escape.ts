/** Close on Escape anywhere on the page (the app bar's panels, the reader rail's); answers the disposer. */
export function closeOnEscape(close: () => void): () => void {
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  window.addEventListener('keydown', escape);
  return () => window.removeEventListener('keydown', escape);
}
