/**
 * POST /api/tokens/claimable — what THIS browser could add to the account it
 * just signed into.
 *
 * The browser's held tokens live in its httpOnly cookie as IDs
 * (lib/agent-session), so the page cannot name them and does not have to: the
 * request carries no body at all, and the server answers from the cookie it
 * already reads. Offers are returned by id, never as secrets — there is no
 * plaintext here to echo.
 *
 * Eligibility (known, unrevoked, still anonymous, minted inside the offer
 * window) lives in lib/users.
 */
import { auth } from '@/auth';
import { AGENT_COOKIE, decodeAgentSession } from '@/lib/agent-session';
import { isCrossSiteRequest, json, parseCookie, unauthorized } from '@/lib/http';
import { claimableTokensById } from '@/lib/users';

/** A browser cannot plausibly hold more than a handful; the cap bounds the query. */
const MAX_TOKENS = 20;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const held = await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
  if (!held) return json({ claimable: [] });
  return json({ claimable: await claimableTokensById(session.user.id, held.tokenIds.slice(-MAX_TOKENS)) });
}
