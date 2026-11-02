import { currentAnchor } from './anchor';
import { writeReloadAnchor } from './reader-mode';
import type { ScrollAnchor } from './scroll-anchor';
/** Keep the reader's position when adopting the first published version. */
export function reloadKeepingPlace(win: Window, preUnmountAnchor?: ScrollAnchor | null): void {
  const anchor = preUnmountAnchor ?? currentAnchor(win);
  if (anchor) writeReloadAnchor(win, anchor);
  win.location.reload();
}
