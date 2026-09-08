import type { SessionState } from './session';

/** Server-owned startup projection, captured before author nodes are mounted.
 * Session is a validated verdict, never a browser cookie-presence guess.
 * Optional SSR alters presentation only; all payload fields retain their ACLs. */
export interface PageBootstrap {
  path: string;
  session: SessionState;
  presentation: 'public' | 'workspace' | 'account' | 'profile' | 'artifact' | 'page';
  /** True only when the supplied route body has been rendered on the server. */
  ssr: boolean;
  profile?: unknown;
  artifact?: unknown;
  home?: unknown;
}
