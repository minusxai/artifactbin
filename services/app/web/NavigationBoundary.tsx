import type { ReactNode } from 'react';

/** A leaving editor commits its DOM and flushes persistence; false retains its mounted draft. */
export type NavigationGuard = () => Promise<boolean>;

/** Central same-origin navigation and guard coordination, including browser back/forward. */
export function NavigationBoundary(_props: { children: ReactNode }): ReactNode {
  throw new Error('seamless-navigation: implement navigation boundary');
}

/** Register a mounted editor's leave contract; dispose registration when it unmounts. */
export function useNavigationGuard(_guard: NavigationGuard | null): void {
  throw new Error('seamless-navigation: implement navigation guard');
}
