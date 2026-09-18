/** The account page's data: the handle, assigned on sight if missing, and the picture's address. */
import { avatarUrl } from '@/lib/avatars';
import { json, unauthorized } from '@/lib/http';
import { ensureUsername, getUserById } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.viewer?.userId) return unauthorized(request);
  const user = await getUserById(actor.viewer.userId);
  const named = user ? await ensureUsername(user) : null;
  return json({ username: named?.username ?? null, image: named ? avatarUrl(named) : null }, 200, { 'Cache-Control': 'no-store' });
}
