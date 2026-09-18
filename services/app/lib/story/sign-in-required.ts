/**
 * THE ONE REFUSAL A READER CAN DO SOMETHING ABOUT.
 *
 * Every other reason a write is unavailable is a fact about the document or the
 * dataset — read-only, no edit access, a data policy that forbids the row — and
 * the honest thing to show is the server's own sentence. Being a GUEST is not
 * like that: the page is not refusing the person, it is refusing an anonymous
 * request for a statement that binds `$_me`, and there is a door two inches
 * away. A page that answered that with "$_me requires a logged-in user" was
 * telling a reader about a parameter binding.
 *
 * So this one reason travels as a CODE rather than as prose: it is what
 * `mutationAccess` carries for the capability the page receives
 * (lib/story/dataflow DataflowState), what the HTTP refusal for a direct call
 * gains beside its unchanged status and `error` (app/a/[id]/mutate), and what
 * `mx.describe()` reports as `unavailableReason` — a code is more useful than a
 * sentence to a script. Every place that draws it for a PERSON turns it back
 * into words here, or into the sign-in door itself.
 */
export const SIGN_IN_REQUIRED = 'sign_in_required';

/** The words the code stands for, where there is nowhere to put a link. */
export const SIGN_IN_TO_DO_THIS = 'Sign in to do this';

/** True for the one reason that is an invitation rather than a verdict. */
export const needsSignIn = (reason: string | null | undefined): boolean => reason === SIGN_IN_REQUIRED;

/**
 * A refusal as a person should read it. The code becomes a sentence; every
 * other reason is already one and is passed through untouched.
 */
export const refusalText = (reason: string | null | undefined): string | null =>
  reason === undefined || reason === null ? null : needsSignIn(reason) ? SIGN_IN_TO_DO_THIS : reason;

/**
 * DID THE DOOR SAY "SIGN IN"? — the client half, for a control that has a
 * Response in hand rather than a reason string.
 *
 * Every door that refuses a KIND answers this code: `401 {error}` from the
 * like, follow, comment and sharing doors, the `409` the fork door has always
 * answered a browser with no owner, and the `403 {code}` a direct `$_me` write
 * gets. A control that sees it navigates to `/login?callbackUrl=…` instead of
 * failing quietly, which is the whole difference between "nothing happened" and
 * "here is the way in".
 *
 * The response is CLONED, so the caller may still read its body for anything
 * else it wants to say.
 */
export async function refusedForSignIn(response: Response): Promise<boolean> {
  if (response.ok) return false;
  try {
    const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
    return body?.error === SIGN_IN_REQUIRED || body?.code === SIGN_IN_REQUIRED;
  } catch {
    return false;
  }
}
