/**
 * THE DOCUMENT FRAME THE SERVER DREW into this app page (lib/document-serving/document-frame), captured before the app
 * mounts: its presence is what makes this load a document page (solid/App ArtifactRoute), and the document page
 * adopts it — moved, never re-created, so its document keeps loading (solid/pages/Document). A route that leaves
 * the document takes the frame and its sheet off the page.
 */
import { STORY_FRAMED_ATTR } from '@/lib/islands/contract';

let servedFrame: HTMLElement | null = null;
let servedPath = '';
/** The served address, until a page claims it ({@link claimServedPath}). */
let unclaimedPath = '';

export function captureServedFrame(): void {
  servedFrame = document.querySelector<HTMLElement>(`body > [${STORY_FRAMED_ATTR}]`);
  servedPath = window.location.pathname;
  unclaimedPath = servedPath;
}

/**
 * Claim the address this document load was served at, ONCE (as the address bar held it when the app mounted, after
 * healing): true for `pathname` the first time it is asked, false ever after and for any other address. What the app
 * page draws there is the server's own answer for the address; any other visit is a client navigation. An address the
 * server answered without a page for it (an unservable document, a refusal) must never be sent back to the server
 * (solid/pages/ArtifactAddress).
 */
export function claimServedPath(pathname: string): boolean {
  const served = unclaimedPath !== '' && pathname === unclaimedPath;
  if (served) unclaimedPath = '';
  return served;
}

/** The served frame's host, while no page has taken it. */
export function servedDocumentFrame(): HTMLElement | null { return servedFrame; }

/** Hand the served frame's host to the document page (once). */
export function adoptServedFrame(): HTMLElement | null {
  const frame = servedFrame;
  servedFrame = null;
  return frame;
}

/** Take the served frame, and its sheet, off the page. */
export function dropServedFrame(): void {
  servedFrame?.remove();
  servedFrame = null;
  document.head.querySelector('style[data-mx-frame-css]')?.remove();
}

/** A client navigation away from the address the frame was served at drops it. */
export function dropServedFrameOnRoute(pathname: string): void {
  if (pathname !== servedPath) { unclaimedPath = ''; dropServedFrame(); }
}
