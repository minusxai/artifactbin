/**
 * THE WELCOME PAGE IS A GATE, NOT A STEP.
 *
 * A new account does not arrive anywhere in particular: the first sign-in lands
 * wherever the login was started from — the home page, a shared document, a
 * folder someone sent. So "show the welcome page once" cannot live inside one
 * flow. It lives here, around the whole route table: wherever this person is,
 * they go to `/welcome` once, carrying the address they were on, and Confirm
 * puts them back on it.
 *
 * THREE CONDITIONS, EACH PREVENTING A DIFFERENT LOOP OR WRONG BOUNCE:
 *  - the session must have LOADED. Before it does there is no `onboarded`, and
 *    a gate that treated "not yet known" as "not onboarded" would bounce every
 *    reader on every cold load, including signed-out ones.
 *  - there must be a `user`, and `onboarded` must be exactly `false`. A guest,
 *    a test user and an anonymous browser have no welcome page to be held at.
 *  - the current route must not be one the person cannot leave without help:
 *    `/welcome` itself (the loop), `/login` (they may be mid-sign-in) and
 *    `/start`.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from './session';

/** Routes the gate never fires on. */
const EXEMPT = new Set(['/welcome', '/login', '/start']);

export function OnboardingGate({ children }: { children: ReactNode }): ReactNode {
  const { session } = useSession();
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (!session?.user || session.onboarded !== false || EXEMPT.has(path)) return children;
  const here = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/welcome?callbackUrl=${encodeURIComponent(here)}`} replace />;
}
