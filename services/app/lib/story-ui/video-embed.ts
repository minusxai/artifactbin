/**
 * The video trust boundary.
 *
 * Raw <iframe> is banned from story markup everywhere (lib/jsx/validate
 * dangerous tags, the paste sanitizer, the surface CSP) because it means
 * "embed any page on the internet". <Video> (components/kit/video.tsx) is the
 * sanctioned exception, and THIS module is its whole authority: an authored
 * src resolves only when its host is on the small allowlist below, and every
 * URL the component may emit is CONSTRUCTED from the parsed video id —
 * authored input is never echoed, so a hostile path or query has nothing to
 * ride on.
 *
 * There are two constructed URLs per source, because there is NO embedded
 * player: the served document's sandbox propagates to nested browsing
 * contexts, so a third-party player iframe inherits the opaque origin and
 * refuses to run (readers saw a dead black frame). `videoEmbedUrl` survives
 * as the publish-door "is this a supported source" gate; `videoWatchUrl` is
 * what the card actually links to — the video's own page, opened in a new
 * tab through the sandbox's allow-popups flags.
 *
 * Pure and DOM-free, so the same rule is testable in the node project and
 * usable server-side (the snapshot renders through the same component).
 */

/** YouTube video ids are exactly 11 URL-safe base64 characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const LOOM_ID = /^[a-f0-9]{24,64}$/;

interface ParsedVideo {
  provider: 'youtube' | 'vimeo' | 'loom';
  id: string;
  start: number | null;
}

/** "90" | "90s" → 90; anything else null. */
function startSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,6})s?$/.exec(raw);
  return m ? Number(m[1]) : null;
}

/**
 * Parse an authored video link into {provider, id, start}, or null when the
 * source is not a recognized video host. Accepts the URL shapes people
 * actually paste — watch pages, short links, share links — not only the
 * /embed/ form. The id is validated against the provider's own shape: it is
 * the only authored bytes that reach a constructed URL.
 */
function parseVideoSrc(src: unknown): ParsedVideo | null {
  if (typeof src !== 'string' || src === '') return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  // The output is always our constructed https URL, so an http link is fine
  // to accept; any other scheme (javascript:, data:) never matches a host.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter(Boolean);
  const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start'));

  const youtube = (id: string): ParsedVideo | null =>
    YOUTUBE_ID.test(id) ? { provider: 'youtube', id, start } : null;

  if (host === 'youtu.be') {
    return path.length === 1 ? youtube(path[0]) : null;
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'www.youtube-nocookie.com') {
    if (path[0] === 'watch') {
      const v = url.searchParams.get('v');
      return v ? youtube(v) : null;
    }
    if ((path[0] === 'embed' || path[0] === 'shorts') && path.length === 2) {
      return youtube(path[1]);
    }
    return null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    return path.length === 1 && VIMEO_ID.test(path[0]) ? { provider: 'vimeo', id: path[0], start } : null;
  }
  if (host === 'player.vimeo.com') {
    return path[0] === 'video' && path.length === 2 && VIMEO_ID.test(path[1])
      ? { provider: 'vimeo', id: path[1], start } : null;
  }
  if (host === 'loom.com' || host === 'www.loom.com') {
    return (path[0] === 'share' || path[0] === 'embed') && path.length === 2 && LOOM_ID.test(path[1])
      ? { provider: 'loom', id: path[1], start } : null;
  }
  return null;
}

/**
 * The canonical embed-player URL, or null for an unsupported source. Nothing
 * renders this in a frame anymore (see the module comment) — it survives as
 * the publish door's supported-source check (lib/story/refs) and the one
 * spelling of the allowlist.
 */
export function videoEmbedUrl(src: unknown): string | null {
  const v = parseVideoSrc(src);
  if (!v) return null;
  if (v.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${v.id}${v.start ? `?start=${v.start}` : ''}`;
  }
  if (v.provider === 'vimeo') return `https://player.vimeo.com/video/${v.id}`;
  return `https://www.loom.com/embed/${v.id}`;
}

/**
 * The canonical WATCH page — where the card sends the reader. Same parse,
 * same allowlist, same constructed-only property as videoEmbedUrl.
 */
export function videoWatchUrl(src: unknown): string | null {
  const v = parseVideoSrc(src);
  if (!v) return null;
  if (v.provider === 'youtube') {
    return `https://www.youtube.com/watch?v=${v.id}${v.start ? `&t=${v.start}s` : ''}`;
  }
  if (v.provider === 'vimeo') return `https://vimeo.com/${v.id}${v.start ? `#t=${v.start}s` : ''}`;
  return `https://www.loom.com/share/${v.id}${v.start ? `?t=${v.start}` : ''}`;
}
