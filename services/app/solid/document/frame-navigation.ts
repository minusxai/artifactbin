/**
 * THE APP PAGE FOLLOWS ITS FRAME'S LINKS — the page half of lib/story-runtime/frame-bridge/links.
 *
 * A reader's click on a link to an app path inside the framed document arrives as STORY_NAVIGATE_MESSAGE
 * (`{ type, href }`). Only the frame's own window on the document's origin is heard, only a root-relative path on this
 * page's own origin is followed, and only while the reader's click is still the page's activation (it reaches the page
 * from the frame) — the frame's sandbox lets the document take the tab on a click only, and this keeps it so. The page
 * answers STORY_NAVIGATING_MESSAGE first (the frame's fallback stands down), then navigates ITSELF:
 *
 *  · an app page (lib/http/app-pages: a static page, a profile) through the app's router;
 *  · anything else — another document, whose frame only the server draws — by a full load (`location.assign`), so
 *    back and forward cross documents as the browser's own history entries.
 */
import { STORY_NAVIGATE_MESSAGE, STORY_NAVIGATING_MESSAGE, type StoryNavigateMessage } from '@/lib/story-runtime/contract';
import { isAppPagePath } from '@/lib/http/app-pages';

interface FrameNavigationOptions {
  win: Window;
  frame: HTMLIFrameElement;
  /** The framed document's origin: the only origin a navigation is heard from. */
  frameOrigin: string;
  /** The app's router (`useNavigate()`), for an app page. */
  navigate: (path: string) => void;
}

/** The URL on this page's own origin a frame's `href` names, or null: it must be a root-relative path. */
export function appNavigationTarget(win: Window, href: unknown): URL | null {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/\\')) return null;
  try {
    const url = new URL(href, win.location.origin);
    return url.origin === win.location.origin ? url : null;
  } catch { return null; }
}

/** Listen for the frame's navigations; returns the disposer. */
export function answerFrameNavigation({ win, frame, frameOrigin, navigate }: FrameNavigationOptions): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const data = event.data as Partial<StoryNavigateMessage> | null;
    if (!data || typeof data !== 'object' || data.type !== STORY_NAVIGATE_MESSAGE) return;
    const url = appNavigationTarget(win, data.href);
    if (!url) return;
    // No reader's click behind it (where the browser says): unanswered, so the frame's own fallback meets the sandbox.
    const activation = (win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    try {
      frame.contentWindow?.postMessage({ type: STORY_NAVIGATING_MESSAGE, href: data.href as string } satisfies StoryNavigateMessage, frameOrigin === 'null' ? '*' : frameOrigin);
    } catch { /* the frame went away */ }
    if (isAppPagePath(url.pathname)) navigate(url.pathname + url.search + url.hash);
    else win.location.assign(url.href);
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
