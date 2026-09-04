/**
 * GET|POST|DELETE /api/users/:id/follow → `{ following, count }`, where the
 * count is the target's FOLLOWERS — the number the button sits next to.
 *
 * The like door's twin, and the same rules: session-only, same-site on the
 * writes, one answer that renders the button. Two differences the object kind
 * forces — an account is public, so there is no readability question, only
 * existence (404); and the pair (you, you) is refused outright (400), on every
 * verb rather than only the writes, because a door that will never allow a
 * relation has no state to report about it either.
 */
import { refusesCrossSite } from '@/lib/auth';
import { json, unauthorized } from '@/lib/http';
import { count, has, link, unlink } from '@/lib/relations';
import { getUserById } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';

type Ctx = { params: Promise<{ id: string }> };

/** Who is asking about which existing account — or the Response that refuses them. */
async function opened(request: Request, ctx: Ctx): Promise<{ id: string; userId: string | null } | Response> {
  const { id } = await ctx.params;
  const actor = await sessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (!(await getUserById(id))) return json({ error: 'not_found' }, 404);
  const userId = actor.viewer?.userId ?? null;
  if (userId === id) return json({ error: 'cannot_follow_self' }, 400);
  return { id, userId };
}

/** The same door, for the two verbs that CHANGE something: an account is required. */
async function acting(request: Request, ctx: Ctx): Promise<{ id: string; userId: string } | Response> {
  const opening = await opened(request, ctx);
  if (opening instanceof Response) return opening;
  return opening.userId ? { id: opening.id, userId: opening.userId } : unauthorized(request);
}

/** The state of the button after whatever just happened. */
async function state(id: string, userId: string | null): Promise<Response> {
  return json({ following: userId ? await has(userId, 'follow', id) : false, count: await count('follow', id) });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const opening = await opened(request, ctx);
  return opening instanceof Response ? opening : state(opening.id, opening.userId);
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const actor = await acting(request, ctx);
  if (actor instanceof Response) return actor;
  await link(actor.userId, 'follow', actor.id);
  return state(actor.id, actor.userId);
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const actor = await acting(request, ctx);
  if (actor instanceof Response) return actor;
  await unlink(actor.userId, 'follow', actor.id);
  return state(actor.id, actor.userId);
}
