'use client';

/**
 * How `?v=2` TRAVELS in a browser, with nothing stored — ported in shape from
 * minusx `lib/http/fetch-patch.ts` and `lib/navigation/url-utils.ts`.
 *
 * Two installers, because a page reaches the server two ways and the flag has
 * to survive both:
 *
 *  1. `installPreviewFetch` patches `window.fetch` so every same-origin
 *     `/api/` call re-appends the flag. Without it the share menu's own PUT
 *     would arrive without the parameter and the door would refuse the very
 *     toggle the UI just offered — which is the failure mode a cookie hides
 *     by accident rather than solves.
 *  2. `installPreviewLinks` rewrites an in-app anchor's href on click, so
 *     navigating does not silently drop you back to production behaviour.
 *     A delegated listener on `document` rather than a Link wrapper: this app
 *     renders almost every navigation as a plain `<a>` (the top bar's
 *     hamburger, the dashboard rows), so one listener covers what a component
 *     could not, and it needs no import discipline to stay covered.
 *
 * Both are NO-OPS when the URL carries no flag — which is every ordinary
 * visit. A patch that rewrites URLs with nothing to carry can only cause harm,
 * so the guard is the first thing each of them checks, on every call, against
 * the CURRENT location (a client navigation changes it without re-running
 * this module).
 */
import { PREVIEW_PARAM, PREVIEW_VERSION, preserveParams } from '@/lib/features';

type FetchLike = typeof globalThis.fetch;

/** True while the window's own URL carries the flag. Re-read per call — the URL changes under us. */
const flagged = (win: Pick<Window, 'location'>): boolean => {
  try {
    return new URLSearchParams(win.location.search).get(PREVIEW_PARAM) === PREVIEW_VERSION;
  } catch {
    return false;
  }
};

/** Only OUR api calls: a same-origin path under /api/. */
function apiTarget(raw: string, origin: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!url.pathname.startsWith('/api/')) return null;
  return url;
}

/**
 * Patch `window.fetch` to carry the flag. Returns a disposer that puts the
 * previous fetch back; installing twice is a no-op (the second call returns a
 * disposer that does nothing), so a double-mounted provider cannot stack
 * patches on top of each other.
 */
export function installPreviewFetch(win: Window & typeof globalThis): () => void {
  const marked = win.fetch as FetchLike & { __mxPreview?: true };
  if (marked.__mxPreview) return () => {};
  // The RAW reference, not a bound copy: the disposer must be able to put
  // back the exact function it replaced, or an uninstall leaves a wrapper
  // behind that the next install cannot recognise as its own.
  const original = win.fetch;
  const call = (input: RequestInfo | URL, init?: RequestInit) => original.call(win, input as RequestInfo, init);

  const patched = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!flagged(win)) return call(input, init);
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = apiTarget(raw, win.location.origin);
    if (!url || url.searchParams.get(PREVIEW_PARAM) === PREVIEW_VERSION) return call(input, init);
    url.searchParams.set(PREVIEW_PARAM, PREVIEW_VERSION);
    const next = `${url.pathname}${url.search}`;
    // A Request carries method, headers and body — rebuild it around the new
    // URL rather than dropping to a bare string, which would lose all three.
    if (typeof input === 'string') return call(next, init);
    if (input instanceof URL) return call(new URL(next, win.location.origin), init);
    return call(new Request(new URL(next, win.location.origin), input), init);
  }) as FetchLike & { __mxPreview?: true };
  patched.__mxPreview = true;

  win.fetch = patched;
  return () => { if (win.fetch === patched) win.fetch = original; };
}

/** A click the browser should keep for itself: new tab/window, download, or non-primary. */
function browserOwnedClick(e: MouseEvent, a: HTMLAnchorElement): boolean {
  return (
    e.button !== 0
    || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
    || a.hasAttribute('download')
    || !!a.getAttribute('target')
  );
}

/**
 * Carry the flag across link navigation by rewriting the anchor's href as it
 * is clicked. Rewriting rather than intercepting: whatever handles the
 * navigation afterwards — the browser, or Next's router — then sees the URL
 * the user is actually going to, and this stays a one-line participant in a
 * click rather than a second router.
 */
export function installPreviewLinks(doc: Document): () => void {
  const onClick = (e: MouseEvent) => {
    const win = doc.defaultView;
    if (!win || !flagged(win)) return;
    if (e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || browserOwnedClick(e, a)) return;
    const href = a.getAttribute('href');
    // The ATTRIBUTE, not `a.href`: the resolved property is absolute, and
    // preserveParams deliberately declines anything that is not our own path.
    if (!href || href.startsWith('#')) return;
    const next = preserveParams(href, win.location.search);
    if (next !== href) a.setAttribute('href', next);
  };
  // Capture, so an in-app handler that stops propagation still gets a
  // rewritten href to navigate to.
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
