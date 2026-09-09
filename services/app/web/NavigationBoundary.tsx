import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, useLocation, useNavigate, useNavigationType, type Location, type BlockerFunction } from 'react-router';
import { parsePrettyPath } from '@/lib/urls';

/** A leaving editor commits its DOM and flushes persistence; false retains its mounted draft. */
export type NavigationGuard = () => Promise<boolean>;

/** Central same-origin navigation and guard coordination, including browser back/forward. */
const Guards = createContext<Set<NavigationGuard> | null>(null);

function documentIdentity(path: string): string {
  const direct = /^\/a\/([^/]+)\/?$/.exec(path);
  if (direct) return `artifact:${direct[1]}`;
  if (path.startsWith('/@')) {
    const file = parsePrettyPath(path.split('/').slice(2));
    if (file) return `artifact:${file.id}`;
  }
  return path;
}

/** Explicit app routes only. Files, API, auth callbacks and docs retain native navigation. */
export function isClientRoute(url: Pick<URL, 'pathname'>): boolean {
  return /^\/(?:$|(?:account|assets|chat|login|privacy|terms|trash|docs-human)\/?$|tokens(?:\/new)?\/?$|datasets\/(?:new|[^/]+\/edit)\/?$|a\/[^/]+\/?$|@[^/]+(?:\/[^/]+)?\/?$)/.test(url.pathname);
}

export function NavigationBoundary({ children }: { children: ReactNode }): ReactNode {
  const guards = useRef(new Set<NavigationGuard>()).current;
  const dataRouter = useContext(UNSAFE_DataRouterContext)!.router;
  const navigate = useNavigate();
  const location = useLocation();
  const action = useNavigationType();
  const inFlight = useRef(false);
  const destination = useRef<Location | null>(null);
  const intentProceed = useRef<(() => void) | null>(null);
  const deferredLocal = useRef<Location | null>(null);
  const blocker = useBlocker(useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    // Signal changes and selection hashes are local state, not a document leave.
    const leaving = documentIdentity(currentLocation.pathname) !== documentIdentity(nextLocation.pathname)
      || (currentLocation.hash === '#edit' && nextLocation.hash !== '#edit');
    if (!leaving) {
      // Do not let a signal URL replace reset the router's blocked POP/REPLACE
      // transition. Its original proceed callback owns history/state semantics.
      if (inFlight.current) { deferredLocal.current = nextLocation; return true; }
      return false;
    }
    if (guards.size === 0) return false;
    destination.current = nextLocation;
    return true;
  }, [guards]));
  const latestBlocker = useRef(blocker);
  latestBlocker.current = blocker;
  useEffect(() => dataRouter.subscribe(state => {
    // React may batch an intentional navigation and its following signal URL
    // update. Observe the router's transitions synchronously so the former's
    // continuation is not lost before React renders the latter. The router
    // itself still owns all history operations, including POP deltas.
    for (const pending of state.blockers.values()) {
      if (pending.state === 'blocked' && pending.location.key === destination.current?.key) intentProceed.current = pending.proceed;
    }
  }), [dataRouter]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (blocker.location.key === destination.current?.key) intentProceed.current = blocker.proceed;
    if (inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      let allowed = true;
      try { for (const guard of [...guards]) if (!await guard()) { allowed = false; break; } }
      catch { allowed = false; }
      inFlight.current = false;
      const current = latestBlocker.current;
      if (!allowed) {
        if (current.state === 'blocked') current.reset();
        if (deferredLocal.current) {
          const local = deferredLocal.current;
          void navigate(local, { replace: true, state: local.state });
        }
      } else if (current.state === 'blocked') {
        // Keep the router's actual continuation (especially its POP delta),
        // rather than synthesizing a push from a location snapshot.
        intentProceed.current?.();
      }
      destination.current = null;
      deferredLocal.current = null;
      intentProceed.current = null;
    })();
  }, [blocker, guards, navigate]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const url = new URL(anchor.href, window.location.href);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) { event.preventDefault(); return; }
      if (url.origin !== window.location.origin || !isClientRoute(url)) return;
      event.preventDefault();
      void navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [navigate]);

  const positions = useRef(new Map<string, [number, number]>());
  const previous = useRef(location);
  useEffect(() => {
    const restore = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const save = () => positions.current.set(previous.current.key, [window.scrollX, window.scrollY]);
    window.addEventListener('scroll', save, { passive: true });
    return () => { window.removeEventListener('scroll', save); window.history.scrollRestoration = restore; };
  }, []);
  useEffect(() => {
    const before = previous.current;
    if (!positions.current.has(before.key)) positions.current.set(before.key, [window.scrollX, window.scrollY]);
    if (positions.current.size > 256) positions.current.delete(positions.current.keys().next().value!);
    previous.current = location;
    if (documentIdentity(before.pathname) === documentIdentity(location.pathname) && before.hash === location.hash && action !== 'POP') return;
    if (location.hash === '#edit') return;
    const position = action === 'POP' ? positions.current.get(location.key) : undefined;
    if (!position && !location.hash) { window.scrollTo(0, 0); return; }
    let hash = location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch { /* Invalid escape is a literal fragment. */ }
    let done = false;
    let timer = 0;
    const stop = () => {
      done = true; mutations.disconnect(); sizes.disconnect(); window.clearTimeout(timer);
      window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); window.removeEventListener('keydown', stop);
    };
    const apply = () => {
      if (done) return;
      if (position) {
        window.scrollTo(...position);
        if (Math.abs(window.scrollY - position[1]) < 1) stop();
      } else {
        const target = document.getElementById(hash);
        if (target) { target.scrollIntoView(); stop(); }
      }
    };
    // Data is fetched after route commit. Retry only on content/size changes,
    // stopping once restored, on user scrolling, or at this bounded deadline.
    const mutations = new MutationObserver(apply);
    const sizes = new ResizeObserver(apply);
    mutations.observe(document.body, { childList: true, subtree: true });
    sizes.observe(document.body);
    window.addEventListener('wheel', stop, { passive: true }); window.addEventListener('touchstart', stop, { passive: true }); window.addEventListener('keydown', stop);
    timer = window.setTimeout(stop, 5000);
    apply();
    return stop;
  }, [location, action]);
  return <Guards.Provider value={guards}>{children}</Guards.Provider>;
}

/** Register a mounted editor's leave contract; dispose registration when it unmounts. */
export function useNavigationGuard(guard: NavigationGuard | null): void {
  const guards = useContext(Guards);
  useEffect(() => {
    if (!guard || !guards) return;
    guards.add(guard);
    return () => { guards.delete(guard); };
  }, [guard, guards]);
}
