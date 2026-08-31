/**
 * Usernames: auto-assigned at login (sanitized email local part + '_' + 4
 * random [a-z0-9], so the exact address is never confirmed and collisions
 * are a non-event), renameable, stored/matched lowercase, underscores only.
 * Old names are RELEASED on rename — every URL is anchored on the file id,
 * so nothing breaks and squatting a stale name buys nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getProfileRoute, PATCH as patchProfileRoute } from '@/app/api/my/profile/route';

import {
  createUser, ensureUsername, getUserByUsername, setUsername, usernameFromEmail, USERNAME_RE,
} from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

beforeEach(async () => {
  sessionUser.id = '';
});

describe('usernameFromEmail (pure)', () => {
  it('lowercases, strips +tags, maps separators to single underscores', () => {
    expect(usernameFromEmail('Mxmx_Test+drafts@Example.com')).toBe('mxmx_test');
    expect(usernameFromEmail('a.b-c@x.com')).toBe('a_b_c');
    expect(usernameFromEmail('__weird..name__@x.com')).toBe('weird_name');
    expect(usernameFromEmail('u@x.com')).toBe('u');
  });

  it('falls back to "user" when nothing survives sanitizing, and clamps long parts', () => {
    expect(usernameFromEmail('++++@x.com')).toBe('user');
    expect(usernameFromEmail(`${'x'.repeat(64)}@x.com`)).toBe('x'.repeat(20));
  });
});

describe('assignment', () => {
  it('ensureUsername gives a fresh account localpart_xxxx and is idempotent', async () => {
    const created = await createUser({ email: 'mxmx_test_owner@example.com' });
    const user = await ensureUsername(created);
    expect(user.username).toMatch(/^mxmx_test_owner_[a-z0-9]{4}$/);
    expect(user.username).toMatch(USERNAME_RE);
    // Second call keeps the assigned name.
    expect((await ensureUsername(user)).username).toBe(user.username);
  });

  it('two accounts with the same local part get distinct usernames', async () => {
    const a = await ensureUsername(await createUser({ email: 'sam@a.com' }));
    const b = await ensureUsername(await createUser({ email: 'sam@b.com' }));
    expect(a.username).not.toBe(b.username);
    expect(b.username).toMatch(/^sam_[a-z0-9]{4}$/);
  });
});

describe('rename', () => {
  it('accepts a free valid name (lowercased), releases the old one', async () => {
    const a = await ensureUsername(await createUser({ email: 'a@a.com' }));
    const oldName = a.username!;
    expect(await setUsername(a.id, 'MXMX_Owner')).toEqual({ ok: true, username: 'mxmx_owner' });
    expect((await getUserByUsername('mxmx_owner'))?.id).toBe(a.id);
    expect(await getUserByUsername(oldName)).toBeNull();

    // The released name is claimable by someone else.
    const b = await ensureUsername(await createUser({ email: 'b@b.com' }));
    expect(await setUsername(b.id, oldName)).toEqual({ ok: true, username: oldName });
  });

  it('rejects taken, malformed, and reserved names', async () => {
    const a = await ensureUsername(await createUser({ email: 'a@a.com' }));
    const b = await ensureUsername(await createUser({ email: 'b@b.com' }));
    expect(await setUsername(b.id, a.username!)).toEqual({ error: 'taken' });
    for (const bad of ['ab', 'has-hyphen', 'has space', 'Ünïcode', 'x'.repeat(33), 'admin', 'api', 'artifactbin']) {
      expect(await setUsername(b.id, bad)).toEqual({ error: 'invalid' });
    }
  });
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
