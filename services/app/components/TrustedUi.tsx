import type { ReactNode } from 'react';

/** First-party CSS isolation, never an author-script or authentication boundary.
 * Callers supply first-party styles only. The root owns its portal target and
 * must dispose it on unmount; no sensitive element is placed in light DOM. */
export interface TrustedUiProps {
  children: ReactNode;
  styles: string;
  mode: 'light' | 'dark';
}

export function TrustedUi(_props: TrustedUiProps): ReactNode {
  throw new Error('TrustedUi: implement');
}

/** Null outside trusted chrome: ordinary app dialogs retain normal behavior. */
export function useTrustedPortalContainer(): HTMLElement | null {
  throw new Error('TrustedUi portal context: implement');
}
