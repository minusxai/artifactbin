/**
 * GET /api/groups/:id/sign-ins — the agents signed in AS this group (contracts identity-service `GROUP_SIGN_IN_RULE`),
 * for one of its Admins (direct, or through an ancestor) on the group's settings page: the level each acts at, who
 * authorised it and whether it is still live. A browser session only; never a secret. Others: 403, or 404 for someone
 * with no role on the group.
 */
import { json, unauthorized } from '@/lib/http';
import { sessionActor } from '@/lib/authentication';
import { GroupError, listGroupSignIns } from '@/lib/groups';

export async function GET(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  const { id } = await ctx.params;
  try { return json({ sign_ins: await listGroupSignIns(actor.userId, String(id)) }); }
  catch (error) { if (error instanceof GroupError) return json({ error: error.code }, error.status); throw error; }
}
