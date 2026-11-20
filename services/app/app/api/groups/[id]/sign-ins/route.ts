/**
 * GET /api/groups/:id/sign-ins — the agents signed in AS this group (contracts identity-service `GROUP_SIGN_IN_RULE`),
 * for one of its Admins (direct, or through an ancestor) on the group's settings page: the level each acts at, who
 * authorised it and whether it is still live. A browser session only; never a secret. Others: 403, or 404 for someone
 * with no role on the group. People's sign-ins come in full, newest first, a page at a time (`?limit=` 1–100, default
 * 20; `?cursor=` the previous page's `next_cursor`, null on the last); a service's come as `services`, one row per
 * approval with how many it holds (revoking the approval, DELETE /api/groups/:id/service-sign-ins/:grantId, ends them).
 */
import { decodePage, encodeCursor, json, Reply, toResponse, unauthorized } from '@/lib/http';
import { sessionActor } from '@/lib/authentication';
import { GroupError, listGroupSignIns } from '@/lib/groups';

export async function GET(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  const { id } = await ctx.params;
  const page = decodePage(Object.fromEntries(new URL(request.url).searchParams), 'sign-ins');
  if (page instanceof Reply) return toResponse(page);
  const after = page.cursor ? { created: String(page.cursor.created), id: String(page.cursor.id) } : undefined;
  try {
    const listed = await listGroupSignIns(actor.userId, String(id), { limit: page.limit, ...(after ? { after } : {}) });
    return json({ sign_ins: listed.sign_ins, next_cursor: listed.next ? encodeCursor('sign-ins', listed.next) : null, services: listed.services });
  }
  catch (error) { if (error instanceof GroupError) return json({ error: error.code }, error.status); throw error; }
}
