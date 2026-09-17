/**
 * DELETE /api/my/tokens/:id — revoke one of THIS account's tokens, from the
 * tokens panel. The browser-credential guards apply: a session is required,
 * and a cookie-authenticated DELETE from a cross-site Origin is CSRF and is
 * refused (a bearer never sends Origin and is never blocked — but a bearer is
 * not this route's caller either). A token that is not this account's is the
 * uniform 404: unknown, revoked and foreign are indistinguishable here.
 */
import { json, unauthorized } from '@/lib/http';
import { sessionActor } from '@/lib/viewer';
import { refusesCrossSite } from '@/lib/auth';
import { revokeUserToken } from '@/lib/users';

export async function DELETE(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.viewer?.userId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  const { id } = await ctx.params;
  if (typeof id !== 'string' || !id) return json({ error: 'not_found' }, 404);
  // Ownership-scoped: the UPDATE simply does not match another account's row.
  return (await revokeUserToken(actor.viewer.userId, id))
    ? new Response(null, { status: 204 })
    : json({ error: 'not_found' }, 404);
}
