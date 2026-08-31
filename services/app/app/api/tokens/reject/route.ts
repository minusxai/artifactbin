/**
 * POST /api/tokens/reject  { tokenId }  (tok-p1)
 *
 * The browser gives a held token back: the token is revoked and its id leaves the agent-session cookie.
 * Capability = the signed cookie carrying the id (the claim-by-id precedent); a body naming an id the
 * cookie does not hold is a uniform 404. Works logged-out (an anonymous browser giving up its own draft
 * credential) and logged-in (then also for tokens this account has claimed). A token claimed by ANOTHER
 * account is never revoked here — 404, nothing changes.
 *
 * 204 with Set-Cookie: the cookie minus this id, or the cleared cookie when it was the last one.
 * Cross-site requests are refused (403), like claim.
 */
import {
  AGENT_COOKIE,
  agentSessionClearCookie,
  agentSessionSetCookie,
  decodeAgentSession,
  encodeAgentSession,
  withoutToken,
} from '@/lib/agent-session';
import { isCrossSiteRequest, json, parseCookie, readJson } from '@/lib/http';
import { revokeHeldToken } from '@/lib/tokens';
import { sessionActor } from '@/lib/viewer';

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request);
  const tokenId = typeof body?.tokenId === 'string' ? body.tokenId : '';
  const held = await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
  if (!tokenId || !held?.tokenIds.includes(tokenId)) return json({ error: 'not_found' }, 404);

  const actor = await sessionActor(request);
  const sessionUserId = actor.credential === 'session' ? actor.viewer?.userId ?? null : null;
  const revoked = await revokeHeldToken(tokenId, sessionUserId);
  if (!revoked) return json({ error: 'not_found' }, 404);

  const remaining = withoutToken(held, tokenId);
  const setCookie = remaining
    ? agentSessionSetCookie(await encodeAgentSession(remaining))
    : agentSessionClearCookie();
  return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie } });
}
