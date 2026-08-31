/**
 * POST/DELETE /api/session/token — the exchange of an `mx_` secret for the
 * httpOnly agent cookie (lib/agent-session), and the sign-out that clears it.
 *
 * The exchange is a CREDENTIAL CHECK: an unknown or revoked token buys
 * nothing (uniform 401). The cookie that comes back names token ids, never
 * the secret, and re-presenting a held token promotes it rather than
 * duplicating — the token you touched last is the one your next write acts
 * as. The app sets the cookie itself with the shared codec (utils
 * encodeAgentSession under AUTH__SECRET); the proxy READS that cookie to
 * build the agent-cookie actor and never writes it.
 */
import {
  AGENT_COOKIE,
  agentSessionClearCookie,
  agentSessionSetCookie,
  decodeAgentSession,
  encodeAgentSession,
  withToken,
} from '@/lib/agent-session';
import { parseCookie, readJson, unauthorized } from '@/lib/http';
import { resolveToken } from '@/lib/tokens';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const body = await readJson(request);
  const offered = typeof body?.token === 'string' ? body.token.trim() : '';
  const token = offered ? await resolveToken(offered) : null;
  if (!token) return unauthorized(request);
  const held = await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
  const value = await encodeAgentSession(withToken(held, token.id));
  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, 'Set-Cookie': agentSessionSetCookie(value) },
  });
}

export async function DELETE(_request?: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, 'Set-Cookie': agentSessionClearCookie() },
  });
}
