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
 * FOUR CONDITIONS, EACH PREVENTING A DIFFERENT LOOP OR WRONG BOUNCE:
 *  - the session must have LOADED. Before it does there is no `onboarded`, and
 *    a gate that treated "not yet known" as "not onboarded" would bounce every
 *    reader on every cold load, including signed-out ones.
 *  - there must be a `user`, and `onboarded` must be exactly `false`. A guest,
 *    a test user and an anonymous browser have no welcome page to be held at.
 *  - the current route must not be one the person cannot leave without help:
 *    `/welcome` itself (the loop), `/login` (they may be mid-sign-in) and
 *    `/start`.
 *  - the address must not carry a PENDING INTENT (lib/intent). A person who
 *    pressed Fork on a document they were signed out of is sent through
 *    /login and back with `?intent=fork`, and that instruction is consumed ON
 *    MOUNT — so diverting here would consume nothing, land them on the welcome
 *    page, and quietly lose the thing they actually asked for. The first person
 *    ever to press Fork is by definition a new account, so this is the common
 *    case and not an edge. They finish what they came for; the gate fires on
 *    their NEXT navigation with that address as the callback, which is one
 *    screen later and costs nothing.
 *
 * `readIntent` rather than a hand-read query parameter, so the strict allowlist
 * is what decides: `?intent=fork` defers the welcome page, `?intent=anything`
 * on a shared link does not.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { readIntent } from '@/lib/intent';
import { useSession } from './session';

/** Routes the gate never fires on. */
const EXEMPT = new Set(['/welcome', '/login', '/start']);

export function OnboardingGate({ children }: { children: ReactNode }): ReactNode {
  const { session } = useSession();
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (!session?.user || session.onboarded !== false || EXEMPT.has(path)) return children;
  if (readIntent(location.search)) return children;
  const here = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/welcome?callbackUrl=${encodeURIComponent(here)}`} replace />;
}
