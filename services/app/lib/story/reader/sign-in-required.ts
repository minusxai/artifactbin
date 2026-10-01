/** Machine-readable authentication refusal for capabilities and direct requests.
 * Render unavailable mutations as disabled controls, preserving authored content. */
export const SIGN_IN_REQUIRED = 'sign_in_required';

/** Translate capability codes for accessible descriptions and refusal messages. */
export const refusalText = (reason: string | null | undefined): string | null =>
  reason === undefined || reason === null ? null : reason === SIGN_IN_REQUIRED ? 'Unavailable while signed out.' : reason;

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
