/**
 * DELETE /api/tokens/:id — the OPERATOR's revoke, gated by the same shared
 * secret as POST /api/tokens. A live token answers 204 and every later call
 * it would have authorized answers 401 on the very next request (resolveToken
 * re-reads the row); an unknown or already-revoked id is the uniform 404, so
 * the endpoint does not exist for anyone without the secret.
 */
import { json } from '@/lib/http';
import { revokeToken } from '@/lib/tokens';
import { hasAdminCredential } from '@/lib/admin-auth';

export async function DELETE(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  if (!hasAdminCredential(request)) return json({ error: 'not_found' }, 404);
  const { id } = await ctx.params;
  if (typeof id !== 'string' || !id) return json({ error: 'not_found' }, 404);
  return (await revokeToken(id)) ? new Response(null, { status: 204 }) : json({ error: 'not_found' }, 404);
}
