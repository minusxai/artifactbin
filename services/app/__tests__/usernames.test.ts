/**
 * Usernames: auto-assigned at login (sanitized email local part + '_' + 4
 * random [a-z0-9], so the exact address is never confirmed and collisions
 * are a non-event), renameable, stored/matched lowercase, underscores only.
 * Old names are RELEASED on rename — every URL is anchored on the file id,
 * so nothing breaks and squatting a stale name buys nothing. The rules are
 * lib/accounts' (lib/accounts/__tests__/users.test.ts); this is the profile door.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getProfileRoute, PATCH as patchProfileRoute } from '@/app/api/my/profile/route';

import { createUser, ensureUsername } from '@/lib/accounts';
import { useAppHarness, request, setSession } from '@/__tests__/harness';

useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id } } : null)));


const sessionUser = { id: '' };

beforeEach(async () => {
  sessionUser.id = '';
});

describe('GET/PATCH /api/my/profile', () => {
  it('401s without a session; reads and renames with one', async () => {
    expect((await getProfileRoute(request('/api/my/profile'))).status).toBe(401);

    const user = await ensureUsername(await createUser({ email: 'me@x.com' }));
    sessionUser.id = user.id;
    const profile = await (await getProfileRoute(request('/api/my/profile'))).json();
    expect(profile).toMatchObject({ email: 'me@x.com', username: user.username });

    const renamed = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'brand_new' } }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ username: 'brand_new' });

    const taken = await createUser({ email: 'other@x.com' });
    await ensureUsername(taken);
    sessionUser.id = taken.id;
    const conflict = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'brand_new' } }));
    expect(conflict.status).toBe(409);
    const invalid = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'no-hyphens' } }));
    expect(invalid.status).toBe(400);
  });
});
