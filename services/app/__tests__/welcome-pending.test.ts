/**
 * `users.welcome_pending`: TRUE only for a person the app first met through
 * their claims (lib/profiles) — the row it creates for them starts with the
 * welcome page pending. A row that already existed keeps its flag on every
 * later sync, and a row made any other way (createUser: fixtures, test
 * people) starts with nothing pending.
 *
 * And what the flag is FOR: `/api/page/session` turns it into `onboarded`, the
 * one bit the app shell reads before it sends a new account to `/welcome`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as sessionPage } from '@/app/api/page/session/route';
import { syncProfile } from '@/lib/profiles';
import { claimToken, createUser, getUserById } from '@/lib/users';
import { avatarUrl, setAvatar } from '@/lib/avatars';
import { objectStore, ObjectUnavailable } from '@/lib/object-store';
import { createTestUser, eraseTestUser } from '@/lib/testusers';
import { mintToken } from '@/lib/tokens';
import { getDb } from '@/lib/db';
import { agentCookie, request, useAppHarness } from '@/__tests__/harness';
import sharp from 'sharp';

useAppHarness();

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));

beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });

const png = () => sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();

describe('welcome_pending', () => {
  it('is set when the app first creates a row from claims, and kept on later syncs', async () => {
    const id = 'usr_welcome_' + Math.random().toString(36).slice(2, 8);
    await syncProfile({ userId: id, email: `mxmx_test_${id}@example.com` });
    expect((await getUserById(id))?.welcome_pending).toBe(true);

    await (await getDb()).query('UPDATE users SET welcome_pending = false WHERE id = $1', [id]);
    await syncProfile({ userId: id, email: `mxmx_test_${id}_renamed@example.com` });
    const after = await getUserById(id);
    expect(after?.email).toBe(`mxmx_test_${id}_renamed@example.com`);
    expect(after?.welcome_pending).toBe(false);
  });

  it('is false for a row created directly, and the row carries no picture', async () => {
    const user = await createUser({ email: 'mxmx_test_direct@example.com' });
    expect(user.welcome_pending).toBe(false);
    expect(user.image_key).toBeNull();
  });
});

describe('GET /api/page/session — onboarded', () => {
  const onboarded = async (cookie?: string) =>
    (await (await sessionPage(request('/api/page/session', cookie ? { cookie } : {}))).json()).onboarded;

  it('is false only for an account that still has the welcome page pending', async () => {
    const user = await createUser({ email: 'mxmx_test_onboard@example.com' });
    sessionUser.id = user.id; sessionUser.email = user.email;
    expect(await onboarded()).toBe(true);

    await (await getDb()).query('UPDATE users SET welcome_pending = true WHERE id = $1', [user.id]);
    expect(await onboarded()).toBe(false);
  });

  it('is true for nobody, for a browser holding only a token, and for a guest row', async () => {
    expect(await onboarded()).toBe(true);

    // An anonymous browser: a token, no account. Nobody to send to /welcome.
    const token = await mintToken('anon-browser');
    const anon = await sessionPage(request('/api/page/session', { cookie: await agentCookie([token.id]) }));
    const anonBody = await anon.json();
    expect(anonBody.user).toBeNull();
    expect(anonBody.onboarded).toBe(true);

    // A GUEST row with the flag set: the gate is for accounts, and a kind that
    // never sees the welcome page must never be held at it.
    const guest = await createUser({ email: 'mxmx_test_guestrow@example.com' });
    await (await getDb()).query("UPDATE users SET kind = 'guest', welcome_pending = true WHERE id = $1", [guest.id]);
    sessionUser.id = guest.id; sessionUser.email = guest.email;
    expect(await onboarded()).toBe(true);
  });

  it('stays uncacheable', async () => {
    expect((await sessionPage(request('/api/page/session'))).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/page/session — user', () => {
  const body = async (cookie?: string) =>
    (await (await sessionPage(request('/api/page/session', cookie ? { cookie } : {}))).json()) as {
      user: { id: string; email: string | null; username: string | null; image: string | null } | null;
      kind: string;
    };

  it('carries the handle and picture address, reading the row without writing it', async () => {
    const user = await createUser({ email: 'mxmx_test_sessionpic@example.com' });
    await (await getDb()).query('UPDATE users SET username = NULL WHERE id = $1', [user.id]);
    sessionUser.id = user.id; sessionUser.email = user.email;

    // No handle yet and no picture: the route reports both as null and does
    // NOT assign a handle — a hot no-store read never writes.
    expect((await body()).user).toEqual({ id: user.id, email: user.email, username: null, image: null });
    expect((await getUserById(user.id))?.username).toBeNull();

    await (await getDb()).query("UPDATE users SET username = 'sessionpic' WHERE id = $1", [user.id]);
    await setAvatar(user.id, await png(), 'image/png');
    const row = await getUserById(user.id);
    const image = avatarUrl(row!);
    expect(image).toMatch(/^\/api\/users\//);
    expect((await body()).user).toEqual({ id: user.id, email: user.email, username: 'sessionpic', image });
  });

  it('is null for nobody and for a browser holding only a token', async () => {
    const none = await body();
    expect(none.kind).toBe('none');
    expect(none.user).toBeNull();

    const token = await mintToken('anon-session-user');
    const anon = await body(await agentCookie([token.id]));
    expect(anon.kind).toBe('anon');
    expect(anon.user).toBeNull();
  });
});

describe('erasing a test user', () => {
  it('takes its picture with it, and survives an object that has already gone', async () => {
    const owner = await createUser({ email: 'mxmx_test_eraseowner@example.com' });
    const token = await mintToken('eraser');
    await claimToken(owner.id, token.token);

    const mint = async () => {
      const minted = await createTestUser({ tokenId: token.id, userId: owner.id });
      if (!minted.ok) throw new Error(minted.error);
      return minted;
    };

    const testuser = await mint();
    const { key } = await setAvatar(testuser.id, await png(), 'image/png');
    await expect(objectStore().get(key)).resolves.toBeInstanceOf(Buffer);

    expect((await eraseTestUser(testuser.id)).erased).toBe(true);
    expect(await getUserById(testuser.id)).toBeNull();
    await expect(objectStore().get(key)).rejects.toBeInstanceOf(ObjectUnavailable);

    // The object store losing the bytes first is not the erase's problem.
    const second = await mint();
    const stored = await setAvatar(second.id, await png(), 'image/png');
    await objectStore().delete(stored.key);
    expect((await eraseTestUser(second.id)).erased).toBe(true);
    expect(await getUserById(second.id)).toBeNull();
  });
});
