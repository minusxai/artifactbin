/**
 * The BROWSER's copy of a bearer token — as an httpOnly cookie, not localStorage.
 *
 * A person with no account can still own documents: they mint an anonymous
 * `mx_` token (or are handed one by /api/start) and their browser must
 * remember it, or the tab that just published cannot edit what it made. That
 * memory must not be a durable credential any script on the app's origin can
 * read and keep, so the browser holds a SIGNED COOKIE NAMING the token ids;
 * the secret itself never returns to the page after the exchange.
 *
 * Deliberately NOT a second NextAuth provider. A provider's session lands in
 * `session.user.id`, and every existing `auth()` guard is `if
 * (!session?.user?.id) return 401` — an anonymous session would start passing
 * them, and `POST /api/tokens/claim` would then write a TOKEN id into
 * `tokens.user_id`. A separate cookie is invisible to those guards by
 * construction: they fail closed, unchanged. (Same signing primitive, same
 * AUTH_SECRET — only the envelope differs.)
 *
 * The payload is a LIST, oldest first, because the browser genuinely holds
 * more than one: a person who published anonymously twice must be able to
 * claim both on sign-up (see ClaimBanner / /api/tokens/claimable). The LAST
 * entry is the primary — the one a write acts as.
 *
 * Ids, not secrets: a stolen cookie is already a session, so storing the
 * plaintext would only add a credential that outlives it. Ids also mean every
 * request re-reads the row, so revoking a token logs the browser out.
 */
import { decodeAgentSession as decodeSigned, encodeAgentSession as encodeSigned } from '@artifactbin/utils';
import { AUTH_SECRET, PUBLIC_BASE_URL } from '@/lib/config';
import { parseCookie } from '@/lib/http';

/**
 * `__Host-` WHEN THE COOKIE IS SECURE, and never otherwise: the prefix forces
 * Secure + Path=/ and FORBIDS a Domain attribute, so no subdomain can plant or
 * overwrite it (cookie tossing) — but a browser rejects it outright over plain
 * http, so the name has to follow the SCHEME, not the environment.
 *
 * It used to follow `NODE_ENV`, while the proxy that SETS this cookie followed
 * the base URL's scheme (packages/proxy/src/agent-cookie `cookieName`). Over
 * https they agree; over HTTP IN PRODUCTION — the self-host default this
 * project ships, `http://localhost:3030` — the proxy wrote `mx-agent-session`
 * and the app read `__Host-mx-agent-session`, so the browser held a session
 * neither side could see. It cost the whole claim flow, silently: a person
 * published anonymously, signed up, and was never offered their drafts.
 *
 * Deliberately a NEW cookie rather than a rename of NextAuth's: renaming that
 * one signs out every existing user on deploy.
 */
const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
export const AGENT_COOKIE = SECURE_COOKIE ? '__Host-mx-agent-session' : 'mx-agent-session';

/** Same 30 days as the NextAuth session — the two expire together. */
export const AGENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** The cookie's own salt (auth.js binds a JWE to the cookie name it lives in). */
const SALT = AGENT_COOKIE;

/** What the cookie carries: the token ids this browser holds, oldest first. */
export interface AgentSession {
  tokenIds: string[];
}

export function agentCookieOptions(): {
  httpOnly: true; sameSite: 'lax'; secure: boolean; path: string; maxAge: number;
} {
  // Secure exactly when the name demands it — the two cannot disagree.
  return { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, path: '/', maxAge: AGENT_COOKIE_MAX_AGE };
}

/** The one Set-Cookie serializer for this cookie — every writer goes through it. */
function serializeAgentCookie(value: string, maxAge: number): string {
  const { httpOnly, sameSite, secure, path } = agentCookieOptions();
  return [
    `${AGENT_COOKIE}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

/** The Set-Cookie header value that stores an encoded session. */
export function agentSessionSetCookie(value: string): string {
  return serializeAgentCookie(value, AGENT_COOKIE_MAX_AGE);
}

/**
 * The Set-Cookie header value that CLEARS the session — same attributes as the
 * set, empty value, Max-Age=0. Same attributes is the contract, not a nicety:
 * outside dev the name is `__Host-`-prefixed, and a browser rejects any
 * Set-Cookie for such a name that lacks Secure or carries a non-/ Path — a
 * clear missing them is silently ignored and the session survives sign-out.
 */
export function agentSessionClearCookie(): string {
  return serializeAgentCookie('', 0);
}

/** Sign a session for the Set-Cookie value. */
export async function encodeAgentSession(session: AgentSession): Promise<string> {
  return encodeSigned({ tokenIds: session.tokenIds }, AUTH_SECRET);
}

/**
 * Read a cookie value back. Every failure — absent, tampered, expired, wrong
 * shape — is the same `null`: this is a credential, so it fails CLOSED.
 */
export async function decodeAgentSession(value: string | undefined | null): Promise<AgentSession | null> {
  const parsed = decodeSigned(value, AUTH_SECRET);
  return parsed && parsed.tokenIds.length ? { tokenIds: parsed.tokenIds } : null;
}

/**
 * Add a token id to what a browser holds, newest LAST (it becomes primary).
 * Re-presenting a held token promotes it rather than duplicating: the token
 * you touched last authorizes your next write, which is what every call site
 * assumes.
 */
export function withToken(session: AgentSession | null, tokenId: string): AgentSession {
  const rest = (session?.tokenIds ?? []).filter((id) => id !== tokenId);
  return { tokenIds: [...rest, tokenId].slice(-8) };
}

/**
 * Hand the browser a token: append its id to what the request's cookie already
 * holds and answer with the Set-Cookie that stores the result. The app sets
 * this cookie itself — there is no proxy instruction any more, one path for
 * every shape (the proxy in front READS the cookie to build the agent-cookie
 * actor and never writes it).
 */
/**
 * The inverse of withToken (tok-p1, reject): drop ONE held id, preserving the order of the rest — the last
 * entry stays the primary. Returns null when nothing remains, which the caller turns into a cleared cookie.
 */
export function withoutToken(session: AgentSession | null, tokenId: string): AgentSession | null {
  const tokenIds = (session?.tokenIds ?? []).filter((id) => id !== tokenId);
  return tokenIds.length ? { tokenIds } : null;
}

export async function withAgentSession(request: Request, res: Response, tokenId: string): Promise<Response> {
  const carried = await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
  res.headers.append('Set-Cookie', agentSessionSetCookie(await encodeAgentSession(withToken(carried, tokenId))));
  return res;
}
