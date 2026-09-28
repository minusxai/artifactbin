/**
 * THE VIEWER OVERLAY SEAM — a no-op until w3-viewer-writes replaces this file (docs §4.1, §6).
 *
 * `boot.ts` calls it once, after the islands hydrated, with the document's context, the page data
 * and the `ViewerSeam` (the only way to move `viewer()` from the signed-in hint to the identity).
 * The replacement fetches `GET /a/:id/viewer` (`data.viewerUrl`) when the page is signed-in-hinted or
 * the plan has viewer-scope queries, patches the store and calls `seam.setViewer`. Until then a
 * signed-in page keeps `{ hinted: true }` and a guest keeps null.
 */
import type { IslandContext, IslandPageData, IslandViewer } from './contract';

/** What boot hands the overlay: the runtime's viewer setter (an `overlay` IslandEvent follows each change). */
export interface ViewerSeam {
  setViewer(viewer: IslandViewer): void;
}

export function loadViewerOverlay(_context: IslandContext, _data: IslandPageData, _seam: ViewerSeam): void {}
