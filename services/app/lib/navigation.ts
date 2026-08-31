/**
 * The navigation the components use, over react-router — the same three
 * calls `next/navigation` gave them (`useRouter().push/replace/refresh`,
 * `usePathname`, `useSearchParams`), so the components did not have to change
 * shape when the app stopped being a Next app.
 */
'use client';
import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams as useRRSearchParams } from 'react-router';

/**
 * `refresh()` — "re-read what this page shows", the one call whose Next
 * meaning has no react-router equivalent. Under Next it refetched the server
 * components in place, keeping every piece of local state; the obvious
 * translation (`navigate(0)`) is `history.go(0)`, a FULL RELOAD, which throws
 * away exactly the state the caller had just set (the claim banner's result,
 * measured: it never painted). So it is an event instead: the pages that hold
 * fetched data listen and re-fetch, and nothing else moves.
 */
export const REFRESH_EVENT = 'mx:refresh';

/** Re-fetch this page's data when something changes it. Runs on mount too if `now`. */
export function useRefreshable(reload: () => void): void {
  useEffect(() => {
    const onRefresh = () => reload();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [reload]);
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (to: string) => void navigate(to),
    replace: (to: string) => void navigate(to, { replace: true }),
    back: () => void navigate(-1),
    /** Re-read the page's data in place — never a reload (see REFRESH_EVENT). */
    refresh: () => window.dispatchEvent(new Event(REFRESH_EVENT)),
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRRSearchParams()[0];
}
