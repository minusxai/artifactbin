/**
 * GET /api/groups/:id/service-sign-ins — a group's approvals of configured services (contracts service-audiences
 * `GROUP_SIGN_IN_PATH`) and the services that may be approved, for one of its Admins (direct, or through an ancestor).
 * POST `{service_id, role}` — an Admin approves one: that service may then sign an agent in as the group at `role`
 * (`member` or `editor`) with nobody present, until an Admin revokes it. A browser session only; same-site writes.
 */
import { json, readJson, unauthorized } from '@/lib/http';
import { refusesCrossSite, sessionActor } from '@/lib/authentication';
import { GroupError, approveServiceGroupSignIn, listServiceGroupSignIns } from '@/lib/groups';

async function admin(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  return actor.userId;
}
const refused = (error: unknown) => { if (error instanceof GroupError) return json({ error: error.code }, error.status); throw error; };

export async function GET(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const userId = await admin(request); if (userId instanceof Response) return userId;
  try { return json(await listServiceGroupSignIns(userId, String((await ctx.params).id))); } catch (error) { return refused(error); }
}

export async function POST(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const userId = await admin(request); if (userId instanceof Response) return userId;
  const body = await readJson(request) as { service_id?: unknown; role?: unknown } | null;
  if (!body) return json({ error: 'invalid_json' }, 400);
  try { return json(await approveServiceGroupSignIn(userId, String((await ctx.params).id), body.service_id, body.role), 201); } catch (error) { return refused(error); }
}
