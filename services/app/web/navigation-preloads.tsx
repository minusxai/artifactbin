import { createContext, type ReactNode } from 'react';

/** Optional context keeps isolated page-data consumers independent of the router. */
export const NavigationPreloadContext = createContext<string | null>(null);
/** Coordinates only admitted route transitions; initial bootstrap remains its current owner. */
export function NavigationPreloads({ children }: { children: ReactNode }): ReactNode {
  // Baseline passthrough: the seeded tests demonstrate the missing preload.
  return children;
}
