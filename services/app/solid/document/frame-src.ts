/**
 * The served document frame's light helpers: which frame and its origin (a fresh first URL is lib/html-reader/frame-src). Separate from
 * ./create-framed-story (the bridge to the frame), which the document page loads only once it has adopted the frame,
 * so the app shell before the frame is ready stays within its page-speed size budget.
 */

/** The served frame a consent grant reloads (brief C's CspConsentBar) and the bridge attaches to. */
export const DOCUMENT_FRAME_SELECTOR = 'iframe[data-mx-document-frame]';

/** The framed document: the server's frame, and the origin its messages must come from. */
export interface FramedDocument { frame: HTMLIFrameElement; origin: string }

/** The frame condition: the served story is one frame on the document's own origin, or the page holds the story itself. */
export function framedDocumentFor(story: HTMLElement, framedOrigin: string | null | undefined): FramedDocument | null {
  const frame = story.querySelector<HTMLIFrameElement>(DOCUMENT_FRAME_SELECTOR);
  return frame && framedOrigin ? { frame, origin: framedOrigin } : null;
}
