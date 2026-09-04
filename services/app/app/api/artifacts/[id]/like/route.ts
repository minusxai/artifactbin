/**
 * GET|POST|DELETE /api/artifacts/:id/like → `{ liked, count }`.
 *
 * ONE answer for all three verbs, because a like button has exactly one
 * question — am I in, and how many of us are there — and a button that had to
 * ask twice would render wrong for a frame after every click.
 *
 * Session-only and same-site on the writes: this is the browser's door, ridden
 * by a cookie, so `refusesCrossSite` applies exactly as it does to the app's
 * other cookie-borne writes. An agent has no business liking things, so there
 * is deliberately no bearer path here.
 *
 * The artifact must be READABLE by whoever is asking: an unreadable one and a
 * missing one are the same 404, so the door never confirms that a private id
 * exists. Anonymous may look (`liked: false`) but not act.
 */
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { refusesCrossSite } from '@/lib/auth';
import { json, unauthorized } from '@/lib/http';
import { count, has, link, unlink } from '@/lib/relations';
import { sessionActor } from '@/lib/viewer';

type Ctx = { params: Promise<{ id: string }> };

/** Who is asking about which readable artifact — or the Response that refuses them. */
async function opened(request: Request, ctx: Ctx): Promise<{ id: string; userId: string | null } | Response> {
  const { id } = await ctx.params;
  const actor = await sessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  const artifact = await getArtifactById(id);
  if (!artifact || !(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404);
  return { id, userId: actor.viewer?.userId ?? null };
}

/** The same door, for the two verbs that CHANGE something: an account is required. */
async function acting(request: Request, ctx: Ctx): Promise<{ id: string; userId: string } | Response> {
  const opening = await opened(request, ctx);
  if (opening instanceof Response) return opening;
  return opening.userId ? { id: opening.id, userId: opening.userId } : unauthorized(request);
}

/** The state of the button after whatever just happened. */
async function state(id: string, userId: string | null): Promise<Response> {
  return json({ liked: userId ? await has(userId, 'like', id) : false, count: await count('like', id) });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const opening = await opened(request, ctx);
  return opening instanceof Response ? opening : state(opening.id, opening.userId);
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const actor = await acting(request, ctx);
  if (actor instanceof Response) return actor;
  await link(actor.userId, 'like', actor.id);
  return state(actor.id, actor.userId);
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const actor = await acting(request, ctx);
  if (actor instanceof Response) return actor;
  await unlink(actor.userId, 'like', actor.id);
  return state(actor.id, actor.userId);
}
