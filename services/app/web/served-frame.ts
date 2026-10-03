/**
 * THE DOCUMENT FRAME THE SERVER DREW into this app page (lib/serving/document-frame), captured before the app
 * mounts: its presence is what makes this load a document page (solid/App ArtifactRoute), and the document page
 * adopts it — moved, never re-created, so its document keeps loading (solid/pages/Document). A route that leaves
 * the document takes the frame and its sheet off the page.
 */
import { STORY_FRAMED_ATTR } from '@/lib/islands/contract';

let servedFrame: HTMLElement | null = null;
let servedPath = '';

export function captureServedFrame(): void {
  servedFrame = document.querySelector<HTMLElement>(`body > [${STORY_FRAMED_ATTR}]`);
  servedPath = window.location.pathname;
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
  if (pathname !== servedPath) dropServedFrame();
}
