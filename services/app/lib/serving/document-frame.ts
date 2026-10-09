/**
 * THE DOCUMENT'S FRAME ON THE APP PAGE — the one way a document is shown on the app's origin.
 *
 * A document is rendered only on its own origin (`<hex(id)>.<pages host>`, lib/http/pages-origin), as the
 * standalone compiled page (`/raw`, lib/compiled-page/assembler). The app page (server/app) is the app's own
 * shell — its bar, its rail, the consent slot — and this one frame, drawn by the SERVER into the shell's body so
 * the document starts loading with the page rather than after the app's code (solid/pages/Document adopts it and
 * talks to it through lib/story-runtime/frame-bridge).
 *
 * The sandbox keeps what a document needs (its scripts on its own origin, popups that leave the sandbox, a link that
 * takes the tab) and nothing it does not; the app's own CSP `frame-src` admits only the pages hosts.
 */
import { escapeHtml } from '@artifactbin/utils/escape';
import { STORY_FRAMED_ATTR } from '@/lib/islands';
import { APP_BAR_H } from '@/lib/story-ui/edit-bar';

/** What the app page needs to draw a document's frame and name the document in its head. */
export interface DocumentFrame {
  /** The frame's first URL: the pages apex's session exchange, carrying this reader's one-time ticket. */
  src: string;
  /** The frame's accessible name. */
  title: string;
  /** The document's own ground while it loads (the app's dotted page never shows behind it). */
  colorMode: 'light' | 'dark';
  /** The document's own title, description and social card, for the app page's head. */
  head: { title: string; description: string | null; image: string };
}

export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads';
export const FRAME_ALLOW = 'fullscreen; clipboard-write';
const GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

/** The frame is the viewport under the app bar: it scrolls inside, the bar and the rail stay above and beside. */
export const DOCUMENT_FRAME_CSS = `[${STORY_FRAMED_ATTR}]{position:fixed;inset:0;top:${APP_BAR_H}px;display:block}`
  + `[${STORY_FRAMED_ATTR}].light{background:${GROUND.light}}[${STORY_FRAMED_ATTR}].dark{background:${GROUND.dark}}`
  + `[${STORY_FRAMED_ATTR}]>iframe{display:block;width:100%;height:100%;border:0;background:transparent}`;

/** The frame's element: `iframe[data-mx-document-frame]` (the one frame a consent grant reloads) in its host. */
export function documentFrameHtml(frame: DocumentFrame): string {
  const iframe = `<iframe data-mx-document-frame="" src="${escapeHtml(frame.src)}" title="${escapeHtml(frame.title)}" name="mx-document" sandbox="${FRAME_SANDBOX}" allow="${FRAME_ALLOW}" referrerpolicy="no-referrer"></iframe>`;
  return `<div ${STORY_FRAMED_ATTR}="" class="${frame.colorMode}">${iframe}</div>`;
}

/** The document's name in the app page's head: its title, description and social card. */
export function documentHeadTags(head: DocumentFrame['head']): string {
  return `<title>${escapeHtml(head.title)}</title>`
    + (head.description ? `<meta name="description" content="${escapeHtml(head.description)}">` : '')
    + `<meta property="og:title" content="${escapeHtml(head.title)}">`
    + (head.description ? `<meta property="og:description" content="${escapeHtml(head.description)}">` : '')
    + `<meta property="og:image" content="${escapeHtml(head.image)}">`
    + '<meta name="twitter:card" content="summary_large_image">';
}
