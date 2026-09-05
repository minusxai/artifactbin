/**
 * POST /api/tokens — the OPERATOR's mint. Not agent-facing (an agent mints its
 * own at /api/tokens/anonymous); `npm run mint` and the ops scripts call this
 * with the deployment's shared secret.
 *
 * The secret is read per REQUEST, not at module load, so a test (or an
 * operator rotating the value) is answered by the value this process holds
 * right now. Failures are a uniform 404: for anyone without the secret, the
 * endpoint does not exist. Unset ⇒ it does not exist for anyone.
 */
import { hasAdminCredential } from '@/lib/admin-auth';
import { json } from '@/lib/http';
import { MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, mintToken } from '@/lib/tokens';

export async function POST(request: Request) {
  if (!hasAdminCredential(request)) return json({ error: 'not_found' }, 404);
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; expiresInHours?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  let expiresInMs: number | undefined;
  if (body.expiresInHours !== undefined) {
    if (typeof body.expiresInHours !== 'number' || !Number.isFinite(body.expiresInHours)) return json({ error: 'invalid_expiry' }, 400);
    expiresInMs = body.expiresInHours * 60 * 60 * 1000;
    if (expiresInMs < MIN_TOKEN_TTL_MS || expiresInMs > MAX_TOKEN_TTL_MS) return json({ error: 'invalid_expiry' }, 400);
  }
  // The mint source is the name's default when the operator gave none.
  const minted = await mintToken(name ?? 'admin', null, undefined, { expiresInMs });
  return json({ id: minted.id, name, token: minted.token, expiresAt: minted.expiresAt }, 201);
}
