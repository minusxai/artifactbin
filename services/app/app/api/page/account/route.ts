/** The account page's data: the handle, assigned on sight if missing. */
import { json, unauthorized } from '@/lib/http';
import { ensureUsername, getUserById } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.viewer?.userId) return unauthorized(request);
  const user = await getUserById(actor.viewer.userId);
  const username = user ? (await ensureUsername(user)).username : null;
  return json({ username }, 200, { 'Cache-Control': 'no-store' });
}
