/**
 * The served document frame's light helpers: which frame, its origin, and a fresh first URL. Separate from
 * ./create-framed-story (the bridge to the frame), which the document page loads only once it has adopted the frame,
 * so the app shell before the frame is ready stays within its page-speed size budget.
 */
import { retryingFetch } from '@/lib/http/retry-lazily';

/** The served frame a consent grant reloads (brief C's CspConsentBar) and the bridge attaches to. */
export const DOCUMENT_FRAME_SELECTOR = 'iframe[data-mx-document-frame]';

/** The framed document: the server's frame, and the origin its messages must come from. */
export interface FramedDocument { frame: HTMLIFrameElement; origin: string }

/** The frame condition: the served story is one frame on the document's own origin, or the page holds the story itself. */
export function framedDocumentFor(story: HTMLElement, framedOrigin: string | null | undefined): FramedDocument | null {
  const frame = story.querySelector<HTMLIFrameElement>(DOCUMENT_FRAME_SELECTOR);
  return frame && framedOrigin ? { frame, origin: framedOrigin } : null;
}

/**
 * A fresh first URL for the document's frame (app/api/page/frame/[id]): a new one-time ticket carrying what only
 * this origin knows — the reader's "Allow once" grants (lib/trust/document-trust carriedTrust) — and the page's
 * `$` values. The served `src` cannot be reused: its ticket is spent.
 */
export async function freshFrameSrc(id: string, search = typeof window === 'undefined' ? '' : window.location.search): Promise<string | null> {
  try {
    const response = await retryingFetch(`/api/page/frame/${encodeURIComponent(id)}${search}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const answer = await response.json() as { src?: unknown };
    return typeof answer.src === 'string' ? answer.src : null;
  } catch { return null; }
}
