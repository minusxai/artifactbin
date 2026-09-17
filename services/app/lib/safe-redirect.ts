/**
 * Where a post-login bounce is allowed to land.
 *
 * `callbackUrl` arrives in the query string, so it is attacker-controlled: a
 * phishing link to `/login?callbackUrl=…` sends the user somewhere of the
 * attacker's choosing the instant they authenticate, wearing a real session.
 *
 * The obvious guard — "must start with `/`" — is NOT enough, which is the whole
 * reason this is a module with tests rather than an inline ternary. `//evil.com`
 * starts with a slash and is a PROTOCOL-RELATIVE URL: browsers read it as
 * `https://evil.com`. `/\evil.com` is treated the same way by several engines.
 *
 * So the check is not textual. Resolve the candidate against our own origin and
 * demand the result still BE our origin — that answers every smuggling trick at
 * once, because it asks the same parser the browser will use.
 */
export function internalRedirectTarget(raw: string | null | undefined, origin: string): string {
  if (!raw) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/'; // unparseable — not a path we are willing to guess at
  }
}
