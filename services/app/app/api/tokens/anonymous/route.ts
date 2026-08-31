/**
 * POST /api/tokens/anonymous — the zero-setup mint an agent starts with.
 *
 * NO rate limit here, on purpose (P2 §H: a door is enforced in exactly one
 * place): the ANON_MINT door is counted by the PROXY in front of this app,
 * before the request is forwarded — a second count in the same process would
 * halve the configured ceiling. The app serves the mint; the door is the
 * proxy's.
 *
 * A signed-in browser's mint is bound to its account from the start, so what
 * it publishes lands in its dashboard without a claim; anyone else gets an
 * anonymous token that reaches only what it itself creates, claimable later.
 */
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
  const body = (await request.json().catch(() => ({}))) as { expiresInHours?: unknown };
  let expiresInMs: number | undefined;
  if (body.expiresInHours !== undefined) {
    if (typeof body.expiresInHours !== 'number' || !Number.isFinite(body.expiresInHours)) return json({ error: 'invalid_expiry' }, 400);
    expiresInMs = body.expiresInHours * 60 * 60 * 1000;
    if (expiresInMs < MIN_TOKEN_TTL_MS || expiresInMs > MAX_TOKEN_TTL_MS) return json({ error: 'invalid_expiry' }, 400);
  }
  const minted = await mintToken(sourcedTokenName('api'), userId, undefined, { expiresInMs });
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
