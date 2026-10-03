/**
 * The third-party sources a document may load — one list for both of its policies: on its own origin
 * (./document-csp) and as the sandboxed `/raw` copy (./markup-csp). Named hosts, never `https:`.
 */
/** The ES module CDNs an author script may import from (`import x from 'https://esm.sh/…'`). */
export const MODULE_CDNS = ['https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com'] as const;
/** Google Fonts' stylesheets and its font files. */
export const FONT_STYLES = 'https://fonts.googleapis.com';
export const FONT_FILES = 'https://fonts.gstatic.com';
/**
 * The hosts an author's `<iframe>` may frame without declaring them: the players the retired `<Video>` card
 * constructed. Any other host is a `<meta name="csp-frame">` in the document's Helmet (lib/story/document/csp-extensions).
 */
export const FRAME_HOSTS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com'] as const;
