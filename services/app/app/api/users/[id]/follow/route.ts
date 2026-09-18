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
import { can, capabilityRefusal, type CapabilityActor } from '@/lib/capabilities';
import { userKindOf } from '@/lib/user-kinds';
import { sessionActor } from '@/lib/viewer';

type Ctx = { params: Promise<{ id: string }> };

/** Who is asking about which existing account — or the Response that refuses them. */
async function opened(request: Request, ctx: Ctx): Promise<{ id: string; actor: CapabilityActor } | Response> {
  const { id } = await ctx.params;
  const actor = await sessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  const target = await getUserById(id);
  // A TEST USER is nobody's to follow from outside its sandbox, and a listing
  // that named one would be the sandbox leaking into a real account's page:
  // unknown and invisible are the same 404, as everywhere else.
  if (!target || (target.kind === 'testuser' && actor.viewer?.userId !== target.parent_user_id && (await userKindOf(actor.viewer?.userId ?? null)) !== 'testuser')) return json({ error: 'not_found' }, 404);
  const userId = actor.viewer?.userId ?? null;
  if (userId === id) return json({ error: 'cannot_follow_self' }, 400);
  return { id, actor: { userId, tokenId: actor.tokenId } };
}

/**
 * The same door, for the two verbs that CHANGE something. A guest holds a
 * userId and may still not follow anybody — `can` is what says so, and the
 * refusal it produces is the sign-in door (lib/capabilities).
 */
async function acting(request: Request, ctx: Ctx): Promise<{ id: string; userId: string } | Response> {
  const opening = await opened(request, ctx);
  if (opening instanceof Response) return opening;
  if (!(await can(opening.actor, 'follow', { userId: opening.id }))) return capabilityRefusal(opening.actor);
  return opening.actor.userId ? { id: opening.id, userId: opening.actor.userId } : unauthorized(request);
}

/** The state of the button after whatever just happened. */
async function state(id: string, userId: string | null): Promise<Response> {
  return json({ following: userId ? await has(userId, 'follow', id) : false, count: await count('follow', id) });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const opening = await opened(request, ctx);
  return opening instanceof Response ? opening : state(opening.id, opening.actor.userId);
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
