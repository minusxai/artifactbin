import { auth } from '@/auth';
import { AGENT_COOKIE, decodeAgentSession } from '@/lib/agent-session';
import { isCrossSiteRequest, json, parseCookie, readJson, unauthorized } from '@/lib/http';
import { claimToken, claimTokenById } from '@/lib/users';

/**
 * POST /api/tokens/claim { token } — session-authenticated. Attaches an
 * anonymous token (and everything it published) to the logged-in user.
 * Unknown/revoked/foreign tokens are a uniform 404.
 * The claimable-token offer remains a 24-hour relevance filter; direct claim
 * by secret or held id remains available after that window and never revives expiry.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  // Cookie-authenticated: a cross-site caller riding the session is CSRF.
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request);

  // Two ways to name the token, one meaning. `tokenId` is what a BROWSER
  // sends: its held tokens live as ids in the agent-session cookie, so it has
  // no secret to present — and the cookie must actually hold that id, or an
  // id from someone else's browser would claim their draft. `token` remains
  // for anything holding the plaintext (an agent, a paste).
  if (typeof body?.tokenId === 'string' && body.tokenId) {
    const held = await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
    if (!held?.tokenIds.includes(body.tokenId)) return json({ error: 'not_found' }, 404);
    const claimed = await claimTokenById(session.user.id, body.tokenId);
    if (!claimed) return json({ error: 'not_found' }, 404);
    return json({ ok: true, claimedArtifacts: claimed.claimedArtifacts });
  }

  if (!body || typeof body.token !== 'string') return json({ error: 'invalid_json' }, 400);
  const claimed = await claimToken(session.user.id, body.token.trim());
  if (!claimed) return json({ error: 'not_found' }, 404);
  return json({ ok: true, claimedArtifacts: claimed.claimedArtifacts });
}
