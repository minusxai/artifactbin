/**
 * DELETE /api/groups/:id/service-sign-ins/:grantId — an Admin of the group (direct, or through an ancestor) revokes an
 * approval: every sign-in a service obtained under it ends on its next request. A browser session only, same-site. An
 * approval that is not this group's live one is the uniform 404.
 */
import { json, unauthorized } from '@/lib/http';
import { refusesCrossSite, sessionActor } from '@/lib/authentication';
import { GroupError, revokeServiceGroupSignIn } from '@/lib/groups';

export async function DELETE(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  const { id, grantId } = await ctx.params;
  try { return await revokeServiceGroupSignIn(actor.userId, String(id), String(grantId), { tokenId: actor.tokenId ?? null }) ? new Response(null, { status: 204 }) : json({ error: 'not_found' }, 404); }
  catch (error) { if (error instanceof GroupError) return json({ error: error.code }, error.status); throw error; }
}
