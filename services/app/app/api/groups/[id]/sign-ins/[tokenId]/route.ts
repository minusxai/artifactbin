/**
 * DELETE /api/groups/:id/sign-ins/:tokenId — an Admin of the group (direct, or through an ancestor) ends one agent's
 * sign-in acting as the group, whoever authorised it; it is refused on its next request. A browser session only, and
 * same-site. A sign-in that is not this group's live one is the uniform 404.
 */
import { json, unauthorized } from '@/lib/http';
import { refusesCrossSite, sessionActor } from '@/lib/authentication';
import { GroupError, revokeGroupSignIn } from '@/lib/groups';

export async function DELETE(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  const { id, tokenId } = await ctx.params;
  try { return await revokeGroupSignIn(actor.userId, String(id), String(tokenId)) ? new Response(null, { status: 204 }) : json({ error: 'not_found' }, 404); }
  catch (error) { if (error instanceof GroupError) return json({ error: error.code }, error.status); throw error; }
}
