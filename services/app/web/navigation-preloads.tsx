import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useSession } from './session';
import { routeLoading } from './route-loading';
import { fetchPageData } from './use-page-data';
import { NavigationPreloadContext } from './navigation-preload-context';

/** Optional context keeps isolated page-data consumers independent of the router. */
export { NavigationPreloadContext } from './navigation-preload-context';
/** Coordinates only admitted route transitions; initial bootstrap remains its current owner. */
export function NavigationPreloads({ children }: { children: ReactNode }): ReactNode {
  const location = useLocation();
  const { pages, sessionError } = useSession();
  const route = routeLoading(location);
  const identity = route?.identity ?? location.pathname;
  // Aliases, signals and hashes retain the request/token, just as the mounted
  // artifact runtime retains its initial URL. No fetch or mutation in render.
  const navigation = useMemo(() => ({ id: location.key, route, editing: location.hash === '#edit' }), [identity]);
  const initial = useRef(navigation);
  useLayoutEffect(() => {
    if (!pages || sessionError || navigation === initial.current) return;
    // A warm child chunk must see this marker before its passive mount load.
    const { route: target, id } = navigation;
    for (const code of target?.code ?? []) void code.preload().catch(() => {});
    if (target?.key && !(navigation.editing && pages.resource(target.key).snapshot().data !== null)) {
      void pages.preload(target.key, id, signal => fetchPageData(target.key!, signal));
    }
    return () => pages.cancelPreloads(id);
  }, [navigation, pages, sessionError]);
  useEffect(() => {
    const seen = new Set<object>();
    let active = 0;
    const intent = (event: Event) => {
      if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
      const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      for (const code of routeLoading(url)?.code ?? []) {
        if (seen.has(code) || seen.size >= 32 || active >= 2) continue;
        seen.add(code); active++;
        void code.preload().catch(() => {}).finally(() => { active--; });
      }
    };
    document.addEventListener('mouseover', intent);
    document.addEventListener('focusin', intent);
    return () => { document.removeEventListener('mouseover', intent); document.removeEventListener('focusin', intent); };
  }, []);
  return <NavigationPreloadContext.Provider value={navigation.id}>{children}</NavigationPreloadContext.Provider>;
}
