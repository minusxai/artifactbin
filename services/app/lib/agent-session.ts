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
 * Anonymous token ownership uses a separate signed cookie, not an account
 * session. Account-only guards must never accept a token id as a user id.
 * The cookie is signed with the configured AUTH__SECRET.
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
import { createHash, randomBytes } from 'node:crypto';
import { parseCookie } from '@/lib/http';
import { actorOf } from '@artifactbin/utils';
import { getDb } from '@/lib/db';

/**
 * `__Host-` WHEN THE COOKIE IS SECURE, and never otherwise: the prefix forces
 * Secure + Path=/ and FORBIDS a Domain attribute, so no subdomain can plant or
 * overwrite it (cookie tossing) — but a browser rejects it outright over plain
 * http, so the name has to follow the SCHEME, not the environment.
 *
 * It used to follow `NODE_ENV`, while the proxy that SETS this cookie followed
 * the base URL's scheme (services/proxy/src/agent-cookie `cookieName`). Over
 * https they agree; over HTTP IN PRODUCTION — the self-host default this
 * project ships, `http://localhost:3030` — the proxy wrote `mx-agent-session`
 * and the app read `__Host-mx-agent-session`, so the browser held a session
 * neither side could see. It cost the whole claim flow, silently: a person
 * published anonymously, signed up, and was never offered their drafts.
 *
 * Keep this separate from the account session cookie so the two kinds of
 * authentication retain distinct lifecycles.
 */
const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
export const AGENT_COOKIE = SECURE_COOKIE ? '__Host-mx-agent-session' : 'mx-agent-session';

/** Anonymous browser session lifetime: 30 days. */
export const AGENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;


/** What the cookie carries: the token ids this browser holds, oldest first. */
export interface AgentSession {
  tokenIds: string[];
  sessionId?: string;
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
  return encodeSigned({ tokenIds: session.tokenIds, sessionId: session.sessionId ?? randomBytes(32).toString('base64url') }, AUTH_SECRET);
}

/**
 * Read a cookie value back. Every failure — absent, tampered, expired, wrong
 * shape — is the same `null`: this is a credential, so it fails CLOSED.
 */
export async function decodeAgentSessionEnvelope(value: string | undefined | null): Promise<AgentSession | null> {
  const parsed = decodeSigned(value, AUTH_SECRET);
  return parsed && parsed.tokenIds.length ? parsed : null;
}

/** The cookie is authority only while its per-browser credential is live. */
export async function liveAgentSession(request: Request): Promise<AgentSession | null> {
  const attached = actorOf(request);
  if (attached) return attached.heldTokenIds?.length ? { tokenIds: attached.heldTokenIds } : null;
  const parsed = await decodeAgentSessionEnvelope(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
  const primary = parsed?.tokenIds.at(-1);
  if (!parsed?.sessionId || !primary || !/^[A-Za-z0-9_-]{43}$/.test(parsed.sessionId)) return null;
  const schema = process.env.AUTH__SCHEMA || 'auth';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) return null;
  try {
    const hash = createHash('sha256').update(parsed.sessionId).digest('hex');
    const row = await (await getDb()).query(`SELECT 1 FROM ${schema}.credentials WHERE kind='agent-browser' AND credential_hash=$1 AND subject_id=$2 AND deleted_at IS NULL AND consumed_at IS NULL AND expires_at>now()`, [hash, primary]);
    return row.rows.length === 1 ? parsed : null;
  } catch { return null; }
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
  const carried = await liveAgentSession(request);
  res.headers.append('Set-Cookie', agentSessionSetCookie(await encodeAgentSession(withToken(carried, tokenId))));
  return res;
}
