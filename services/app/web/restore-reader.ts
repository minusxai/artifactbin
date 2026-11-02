/**
 * Restore a compiled /a reader's place after a reload, before the optional app boots. The modules that do it
 * (envelope parsing, the anchor hold) load only when `window.name` actually carries a parked place
 * (lib/story-runtime/reader-mode: `mx:doc:` / legacy `mx:anchor:`), so an ordinary page load carries none of that
 * code on the way to ready.
 */
export function restoreReloadedReader(win: Window = window): Promise<void> {
  if (!/^mx:(?:doc|anchor):/.test(win.name)) return Promise.resolve();
  return Promise.all([
    import('@/lib/html-reader/anchor'),
    import('@/lib/html-reader/anchor-restore'),
    import('@/lib/html-reader/reader-mode'),
  ]).then(([{ applyAnchor }, { holdAnchor }, { takeReloadAnchor }]) => {
    const kept = takeReloadAnchor(win);
    if (kept) holdAnchor(win, kept, applyAnchor);
  }, () => { /* the reader simply opens at the top */ });
}
