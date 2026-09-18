/**
 * GET/PATCH /api/my/profile — the account's public identity. Session-only.
 * PATCH accepts { username }: 400 invalid (charset/length/reserved),
 * 409 taken. The old name is released — URLs are id-anchored, so a rename
 * breaks nothing (any link carrying the stale name self-corrects by id).
 *
 * It also carries the two things the WELCOME page needs and nothing else
 * serves: the picture's address, and whether that page is still pending. So
 * PATCH takes `{ welcome_pending: false }` as well — only false, because
 * "un-confirm me" is not something a person can ask for — and both keys may
 * arrive in one body, which is what Confirm sends: one request, one answer,
 * and a refused rename leaves the confirmation undone rather than half-applied.
 */
import { auth } from '@/auth';
import { avatarUrl } from '@/lib/avatars';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { confirmWelcome } from '@/lib/profiles';
import { ensureUsername, getUserById, setUsername } from '@/lib/users';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  const user = await getUserById(session.user.id);
  if (!user) return unauthorized(request);
  // An account that has no handle yet is given one on sight.
  const withName = await ensureUsername(user);
  return json({
    email: withName.email,
    username: withName.username,
    name: withName.name,
    image: avatarUrl(withName),
    welcome_pending: withName.welcome_pending,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  // Cookie-authenticated: a cross-site caller riding the session is CSRF.
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_username' }, 400);

  const confirming = 'welcome_pending' in body;
  // The flag only ever goes DOWN, and only from here. `true`, `'false'` and
  // `null` are all the same refusal: this door does not guess at intent.
  if (confirming && body.welcome_pending !== false) return json({ error: 'invalid_welcome_pending' }, 400);
  const renaming = 'username' in body;
  if (!confirming && !renaming) return json({ error: 'invalid_username' }, 400);

  const answer: { username?: string; welcome_pending?: false } = {};
  if (renaming) {
    if (typeof body.username !== 'string') return json({ error: 'invalid_username' }, 400);
    const result = await setUsername(session.user.id, body.username);
    if ('error' in result) {
      return result.error === 'taken'
        ? json({ error: 'username_taken' }, 409)
        : json({ error: 'invalid_username' }, 400);
    }
    answer.username = result.username;
  }
  if (confirming) {
    await confirmWelcome(session.user.id);
    answer.welcome_pending = false;
  }
  return json(answer);
}
