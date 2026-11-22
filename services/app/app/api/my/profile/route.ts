/**
 * GET/PATCH /api/my/profile — the account's public identity. Session-only.
 * PATCH accepts a display name (name), a handle (username), or both. Handle errors are 400 invalid,
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
import { services } from '@/lib/platform';
import { auth } from '@/auth';
import { avatarUrl } from '@/lib/avatars';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { confirmWelcome, ensureUsername, getUserById } from '@/lib/accounts';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  const user = await getUserById(session.user.id);
  if (!user) return unauthorized(request);
  // An account that has no handle yet is given one on sight.
  const withName = await ensureUsername(user);
  return json({
    managed_username: await services().identity.hasManagedUsername({userId:withName.id}),
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
  const naming = 'name' in body;
  if ('id' in body && body.id !== session.user.id) return json({ error: 'not_found' }, 404);
  if (!confirming && !renaming && !naming) return json({ error: 'invalid_username' }, 400);

  const answer: { username?: string; name?: string; welcome_pending?: false } = {};
  if (renaming || naming) {
    if (renaming && typeof body.username !== 'string') return json({ error: 'invalid_username' }, 400);
    if (naming && typeof body.name !== 'string') return json({ error: 'invalid_name' }, 400);
    const names = {
      ...(typeof body.username === 'string' && {username:body.username}),
      ...(typeof body.name === 'string' && {name:body.name}),
    };
    const result = await services().identity.setProfileNames({userId:session.user.id,...names});
    if ('error' in result) {
      if (result.error === 'managed_username') return json({error:result.error}, 409);
      if (result.error === 'taken') return json({error:'username_taken'}, 409);
      return json({error:result.error === 'invalid_name' ? 'invalid_name' : 'invalid_username'}, 400);
    }
    if (names.username !== undefined) answer.username = names.username.trim().toLowerCase();
    if (names.name !== undefined) answer.name = names.name.trim();
  }
  if (confirming) {
    await confirmWelcome(session.user.id);
    answer.welcome_pending = false;
  }
  return json(answer);
}
