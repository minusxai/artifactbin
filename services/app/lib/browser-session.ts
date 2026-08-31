/**
 * The browser's side of the token exchange: hand the token to the server
 * once, and from then on the httpOnly cookie authorizes every request
 * automatically. Nothing here reads a credential back, because nothing can —
 * that is the point, and it is why call sites build no `Authorization`
 * header: a same-origin fetch already sends the cookie.
 *
 * Two entry points: `adoptToken`, used exactly where a token first ENTERS the
 * browser (the /start flow, a pasted token, a fresh anonymous mint), and
 * `forgetTokens`, the anonymous owner's sign-out.
 */

/**
 * Exchange a plaintext token for the session cookie. True when the server
 * accepted it — an unknown or revoked token is a plain false, the same uniform
 * answer every bearer surface gives.
 */
export async function adoptToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/session/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false; // offline or blocked — the caller stays unauthorized
  }
}

/** Forget every token this browser holds (the anonymous owner's sign-out). */
export async function forgetTokens(): Promise<void> {
  try {
    await fetch('/api/session/token', { method: 'DELETE' });
  } catch {
    /* nothing to do — the cookie either cleared or the browser is offline */
  }
}
