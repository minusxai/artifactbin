import { currentAnchor } from '@/lib/story-runtime/anchor';
import { writeReloadAnchor } from '@/lib/story-runtime/reader-mode';

/** Single handoff for a compiled reader's document revision. */
export const compiledReaderUpdates = {
  reload(win: Window = window): void {
    const anchor = currentAnchor(win);
    if (anchor) writeReloadAnchor(win, anchor);
    win.location.reload();
  },
};
