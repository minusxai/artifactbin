/**
 * POST /api/internal/tokens — THE MINT, and the only one in the product.
 *
 * INTERNAL means internal: the prefix is refused at the edge (proxy parts
 * `internalBoundary`, contracts `isInternalApiPath`), so no client can reach
 * this. Its one caller is the proxy's own device-approval exchange (proxy
 * routes/oauth `mintFor`), which calls the app over the upstream seam — a
 * Request the parts never saw — after a human approved the connection in the
 * browser. That approval IS the door; there is no public one.
 *
 * The grant rides the ACTOR the proxy attaches, exactly as on any other route:
 * a session actor (the human logged in and approved) binds the token to that
 * account, so what the agent publishes lands in their dashboard; no actor is
 * the anonymous approval, which reaches only what it itself creates.
 *
 * NO rate limit here, on purpose (P2 §H: a door is enforced in exactly one
 * place): the proxy counts the OAuth doors in front of the approval that
 * reaches this.
 */
import {API_RESOURCE_PATH,ARTIFACT_SCOPE} from '@artifactbin/contracts';
import { baseUrl, json } from '@/lib/http';
import { agentContract } from '@/lib/agent-contract';
import { MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, mintToken, sourcedTokenName } from '@/lib/tokens';
import { sessionActor } from '@/lib/viewer';

export async function POST(request: Request) {
  // Only an ACCOUNT session binds the mint: the agent cookie names a token
  // this browser already holds, and that token's ownership is not this
  // route's to change.
  const actor = await sessionActor(request);
  const userId = actor.credential === 'session' ? actor.viewer?.userId ?? null : null;
  const body = (await request.json().catch(() => ({}))) as { expiresInHours?: unknown; audience?: unknown; scope?: unknown };
  let expiresInMs: number | undefined;
  if (body.expiresInHours !== undefined) {
    if (typeof body.expiresInHours !== 'number' || !Number.isFinite(body.expiresInHours)) return json({ error: 'invalid_expiry' }, 400);
    expiresInMs = body.expiresInHours * 60 * 60 * 1000;
    if (expiresInMs < MIN_TOKEN_TTL_MS || expiresInMs > MAX_TOKEN_TTL_MS) return json({ error: 'invalid_expiry' }, 400);
  }
  let audience: string | undefined;
  let scope: string | undefined;
  if (body.audience !== undefined || body.scope !== undefined) {
    if (actor.credential !== 'session' || typeof body.audience !== 'string' || body.scope !== ARTIFACT_SCOPE) return json({ error: 'invalid_audience' }, 400);
    try {
      const target = new URL(body.audience);
      const loopback = target.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
      if ((target.protocol !== 'https:' && !loopback) || target.pathname !== API_RESOURCE_PATH || target.search || target.hash || target.username || target.password) return json({ error: 'invalid_audience' }, 400);
      audience = target.href;
      scope = body.scope;
    } catch {
      return json({ error: 'invalid_audience' }, 400);
    }
  }
  const minted = await mintToken(sourcedTokenName('api'), userId, undefined, { expiresInMs, audience, scope });
  return json(
    {
      id: minted.id,
      token: minted.token,
      expiresAt: minted.expiresAt,
      note: agentContract(baseUrl(request)),
    },
    201,
  );
}
