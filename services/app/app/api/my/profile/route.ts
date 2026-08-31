/**
 * GET/PATCH /api/my/profile — the account's public identity. Session-only.
 * PATCH accepts { username }: 400 invalid (charset/length/reserved),
 * 409 taken. The old name is released — URLs are id-anchored, so a rename
 * breaks nothing (any link carrying the stale name self-corrects by id).
 */
import { auth } from '@/auth';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { ensureUsername, getUserById, setUsername } from '@/lib/users';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  const user = await getUserById(session.user.id);
  if (!user) return unauthorized(request);
  // Sessions minted before usernames existed reach here without one.
  const withName = await ensureUsername(user);
  return json({ email: withName.email, username: withName.username, name: withName.name });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  // Cookie-authenticated: a cross-site caller riding the session is CSRF.
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (!body || typeof body.username !== 'string') return json({ error: 'invalid_username' }, 400);
  const result = await setUsername(session.user.id, body.username);
  if ('error' in result) {
    return result.error === 'taken'
      ? json({ error: 'username_taken' }, 409)
      : json({ error: 'invalid_username' }, 400);
  }
  return json({ username: result.username });
}
