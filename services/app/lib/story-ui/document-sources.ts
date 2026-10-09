/**
 * The third-party sources a document may load — one list for both of its policies: on its own origin
 * (lib/compiled-page/styles/document-csp) and as the sandboxed `/raw` copy (lib/compiled-page/styles/markup-csp). Named
 * hosts, never `https:`. A reader-kit leaf in lib/story-ui: the interpreter asks it too (`needsFrameReferrer`).
 */
/** The ES module CDNs an author script may import from (`import x from 'https://esm.sh/…'`). */
export const MODULE_CDNS = ['https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com'] as const;
/** Keep the document policy's existing interface while sharing its canonical origins with the session relay. */
export { FONT_FILES, FONT_STYLES } from '@artifactbin/contracts/font-sources';
/**
 * The hosts an author's `<iframe>` may frame without declaring them: popular providers' official iframe embeds
 * (no provider script), each on its narrowest embed origin. Form and booking tools stay behind the reader's consent
 * (a default-framed form is a phishing page), as does any origin wider than its embed (Google Maps is all of
 * www.google.com). Any other host is a `<meta name="csp-frame">` in the document's Helmet
 * (lib/document/csp-extensions). The markup reference teaches each provider's embed URL.
 */
export const FRAME_HOSTS = [
  // Video
  'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com',
  'https://fast.wistia.net', 'https://www.dailymotion.com', 'https://geo.dailymotion.com', 'https://www.tiktok.com',
  // Social posts
  'https://platform.twitter.com', 'https://www.instagram.com', 'https://embed.bsky.app', 'https://embed.reddit.com',
  'https://www.linkedin.com', 'https://www.threads.net',
  // Audio
  'https://open.spotify.com', 'https://w.soundcloud.com', 'https://embed.music.apple.com', 'https://embed.podcasts.apple.com',
  // Code
  'https://codepen.io', 'https://codesandbox.io', 'https://stackblitz.com',
  // Design and whiteboards
  'https://embed.figma.com', 'https://www.figma.com', 'https://miro.com', 'https://www.canva.com',
  // Data and maps
  'https://observablehq.com', 'https://public.tableau.com',
  'https://www.openstreetmap.org',
] as const;
/**
 * The players that refuse to play without a referrer (YouTube: "Error 153"). The document is served `no-referrer`,
 * so their frame alone sends its origin, never its path.
 */
const REFERRER_FRAME_HOSTS: ReadonlySet<string> = new Set(['https://www.youtube.com', 'https://www.youtube-nocookie.com']);
export function needsFrameReferrer(src: string): boolean {
  try { return REFERRER_FRAME_HOSTS.has(new URL(src).origin); } catch { return false; }
}
