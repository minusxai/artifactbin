import type { ReactNode } from 'react';

/** CSS boundary for first-party UI. Author content must never be mounted inside it. */
export interface TrustedUiProps {
  children: ReactNode;
}

/** Owns the protected root and its portal destination; no extra document or auth origin. */
export function TrustedUi(_props: TrustedUiProps): ReactNode {
  throw new Error('seamless-navigation: implement trusted UI boundary');
}

/** Dialogs and popovers must inherit this destination instead of escaping into author CSS. */
export function useTrustedPortalContainer(): HTMLElement | undefined {
  throw new Error('seamless-navigation: implement trusted portal destination');
}
