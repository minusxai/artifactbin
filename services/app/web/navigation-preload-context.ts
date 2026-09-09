import { createContext } from 'react';

/** Isolated page-data consumers need no router or route-code dependency. */
export const NavigationPreloadContext = createContext<string | null>(null);
