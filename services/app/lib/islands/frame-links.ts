/**
 * THE FRAME'S APP LINKS — a link inside a framed document that leads to the APP takes the app page, not the frame.
 *
 * A document runs on its own origin (APP__PAGES_HOST), so `<a href="/a/<B>">` or `<a href="/">` resolves against the
 * DOCUMENT's origin, where no app page lives. Installed by the page behaviour (lib/islands/page) in every framed
 * document, this listener takes a reader's click on such a link — root-relative, or absolute on the document's own
 * origin or the app's — and asks the app page to follow it (STORY_NAVIGATE_MESSAGE, lib/story-runtime/contract). The
 * app page (solid/document/frame-navigation) answers STORY_NAVIGATING_MESSAGE and navigates itself; a frame that
 * hears no answer in time (the app's code has not run yet) takes the top to the app's address itself, which the
 * frame's sandbox allows on a reader's click (`allow-top-navigation-by-user-activation`).
 *
 * A hash within this document stays in the frame despite the compiled page's top-navigation base.
 * Left alone: another host or scheme, a
 * `download`, a link the author's script already handled (`defaultPrevented`), and any link in an editable region —
 * the browser follows no link while editing. A modified or middle click, or a `target` other than this tab, opens
 * the APP's address in a new tab instead of the document origin's.
 *
 * Framework-free: it is part of every framed reader's `@mx/page` chunk.
 */
import { STORY_NAVIGATE_MESSAGE, STORY_NAVIGATING_MESSAGE, type StoryNavigateMessage } from '@/lib/story-runtime/contract';

/** How long the frame waits for the app page's answer before taking the top itself: a cross-process round trip. */
const NAVIGATE_ANSWER_MS = 300;

/**
 * The app path (pathname, query and hash) a link in this document leads to, or null when it is not the app's: another
 * host, a scheme other than http(s), or a `#hash` within this document. `raw` is the link's own `href` attribute.
 */
export function appLinkPath(href: string, raw: string | null, documentUrl: string, appOrigin: string): string | null {
  if (raw === null || raw.trim().startsWith('#')) return null;
  let url: URL, here: URL;
  try { url = new URL(href, documentUrl); here = new URL(documentUrl); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== here.origin && url.origin !== appOrigin) return null;
  if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search && url.hash) return null;
  return url.pathname + url.search + url.hash;
}

type Link = HTMLAnchorElement | HTMLAreaElement;
/** The link a click landed in, through shadow roots (islands render in them); SVG links (no string href) are not followed here. */
function linkOf(event: Event): Link | null {
  for (const node of event.composedPath()) {
    const el = node as Partial<Link> & { localName?: string; hasAttribute?: (name: string) => boolean };
    if ((el.localName === 'a' || el.localName === 'area') && typeof el.href === 'string' && el.hasAttribute?.('href')) return el as Link;
  }
  return null;
}

const EDITABLE = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
const editable = (link: Link) => link.isContentEditable === true || !!link.closest(EDITABLE);
const opensElsewhere = (link: Link) => { const target = link.target.trim().toLowerCase(); return !!target && !['_self', '_top', '_parent'].includes(target); };

/** Follow app links through the app page. `appOrigin` is the origin that frames this document (door `frameAppOrigin`). */
export function followAppLinks(win: Window, appOrigin: string, answerMs = NAVIGATE_ANSWER_MS): () => void {
  if (!/^https?:\/\/[^/]+$/.test(appOrigin)) return () => {};
  const parent = win.parent;
  let waiting: { href: string; timer: number } | null = null;
  const settle = () => { if (waiting) { win.clearTimeout(waiting.timer); waiting = null; } };
  const takeTop = (href: string) => {
    let url: URL;
    try { url = new URL(href, appOrigin); } catch { return; }
    if (url.origin !== appOrigin) return;
    try { win.top!.location.href = url.href; } catch { /* the sandbox refused */ }
  };

  const onAnswer = (event: MessageEvent) => {
    if (!waiting || event.source !== parent || event.origin !== appOrigin) return;
    const data = event.data as Partial<StoryNavigateMessage> | null;
    if (data && typeof data === 'object' && data.type === STORY_NAVIGATING_MESSAGE && data.href === waiting.href) settle();
  };
  const follow = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const link = linkOf(event);
    if (!link || link.hasAttribute('download') || editable(link)) return;
    const raw = link.getAttribute('href');
    // The compiled base defaults ordinary links to the top. A same-document anchor must instead
    // scroll this running document, keeping its reader state and the surrounding app in place.
    const destination = new URL(link.href, win.location.href);
    const here = new URL(win.location.href);
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      && (!link.target || link.target.toLowerCase() === '_self')
      && destination.origin === here.origin && destination.pathname === here.pathname && destination.search === here.search
      && (destination.hash || raw?.trim().startsWith('#'))) {
      event.preventDefault();
      win.location.hash = destination.hash || '#';
      return;
    }
    const href = appLinkPath(link.href, raw, win.location.href, appOrigin);
    if (href === null) return;
    event.preventDefault();
    if (event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey || opensElsewhere(link)) {
      win.open(appOrigin + href, '_blank', 'noopener');
      return;
    }
    settle();
    waiting = { href, timer: win.setTimeout(() => { waiting = null; takeTop(href); }, answerMs) };
    try { parent.postMessage({ type: STORY_NAVIGATE_MESSAGE, href } satisfies StoryNavigateMessage, appOrigin); } catch { /* the page went away */ }
  };
  const onClick = (event: MouseEvent) => { if (event.button === 0) follow(event); };
  const onAuxClick = (event: MouseEvent) => { if (event.button === 1) follow(event); };
  // Bubble phase on the window: the author's script and the editor have had the click first.
  win.addEventListener('click', onClick);
  win.addEventListener('auxclick', onAuxClick);
  win.addEventListener('message', onAnswer);
  return () => {
    settle();
    win.removeEventListener('click', onClick);
    win.removeEventListener('auxclick', onAuxClick);
    win.removeEventListener('message', onAnswer);
  };
}
