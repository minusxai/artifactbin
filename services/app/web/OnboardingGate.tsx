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
 *  - the address must not be one where a PENDING INTENT (lib/intent) is being
 *    carried out. Somebody who pressed Fork on a document they were signed out
 *    of is sent through /login and back with `?intent=fork`; diverting there
 *    would land them on the welcome page having quietly lost the thing they
 *    asked for. The first person ever to press Fork is by definition a new
 *    account, so this is the common case and not an edge.
 *
 * THE EXEMPTION LASTS FOR THE WHOLE STAY ON THAT ADDRESS, not for as long as
 * the parameter is there, and that is the entire subtlety. An intent is an
 * INSTRUCTION: the document consumes it on mount — opening the fork dialog —
 * and immediately strips it from the address with a replace navigation. That
 * strip re-renders this gate with an ordinary-looking address, and a gate that
 * only asked "is there an intent right now" would divert on it and unmount the
 * dialog under the person who had just asked for it. Measured doing exactly
 * that: the browser ended on `/welcome?callbackUrl=%2F%40owner%2F<id>-fork-gate`
 * with the dialog gone.
 *
 * So the PATHNAME an instruction was seen on is remembered, and while we are
 * still on it the person is left alone to finish. The moment they leave — the
 * fork opens the copy at its own address — the memory is dropped and the gate
 * decides normally, so the welcome page is owed one screen later with that new
 * address as the callback. Nothing is skipped; it is deferred.
 *
 * `readIntent` rather than a hand-read query parameter, so the strict allowlist
 * is what decides: `?intent=fork` defers the welcome page, `?intent=anything`
 * on a shared link does not.
 */
import { useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { readIntent } from '@/lib/intent';
import { useSession } from './session';

/** Routes the gate never fires on. */
const EXEMPT = new Set(['/welcome', '/login', '/start']);

export function OnboardingGate({ children }: { children: ReactNode }): ReactNode {
  const { session } = useSession();
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/';

  /*
   * The address an instruction was seen on, held until we leave it. Derived
   * DURING RENDER rather than in an effect because it has to be right on the
   * very render that decides — an effect would run after this one had already
   * returned a `<Navigate>`. The write is idempotent for a given location, so
   * rendering the same address twice computes the same answer.
   */
  const carryingOut = useRef<string | null>(null);
  if (readIntent(location.search)) carryingOut.current = location.pathname;
  else if (carryingOut.current !== location.pathname) carryingOut.current = null;

  if (!session?.user || session.onboarded !== false || EXEMPT.has(path)) return children;
  if (carryingOut.current === location.pathname) return children;
  const here = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/welcome?callbackUrl=${encodeURIComponent(here)}`} replace />;
}
