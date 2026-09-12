/**
 * The browser's side of the token exchange: hand the token to the server
 * once, and from then on the httpOnly cookie authorizes every request
 * automatically. Nothing here reads a credential back, because nothing can —
 * that is the point, and it is why call sites build no `Authorization`
 * header: a same-origin fetch already sends the cookie.
 *
 * One entry point: `forgetTokens`, the anonymous owner's sign-out. A token
 * ENTERS the browser through `POST /api/session/token` — the CLI's browser
 * approval and the /start flow both call that route directly, so no page
 * script has to hold the secret even for a moment.
 */

/** Forget every token this browser holds (the anonymous owner's sign-out). */
export async function forgetTokens(): Promise<void> {
  try {
    await fetch('/api/session/token', { method: 'DELETE' });
  } catch {
    /* nothing to do — the cookie either cleared or the browser is offline */
  }
}
