/**
 * THE PROFILE PICTURE'S THREE DOORS.
 *
 * `PUT/DELETE /api/my/profile/image` is the person's own, cookie-authenticated
 * and therefore same-site only; `GET /api/users/<id>/avatar` is PUBLIC by id,
 * exactly as the handle is; and `/api/my/profile` is where the client learns
 * the address and whether the welcome page is still pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { DELETE as deleteImageRoute, PUT as putImageRoute } from '@/app/api/my/profile/image/route';
import { GET as getAvatar } from '@/app/api/users/[id]/avatar/route';
import { GET as getProfile, PATCH as patchProfile } from '@/app/api/my/profile/route';
import { AVATAR_MAX_BYTES, avatarVersion } from '@/lib/avatars';
import { getDb } from '@/lib/db';
import { createUser, ensureUsername, getUserById } from '@/lib/users';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

beforeEach(() => { sessionUser.id = ''; });

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 40, b: 60 } } }).png().toBuffer();

/** PUT these bytes as the signed-in person's picture. */
const putImage = (bytes: Uint8Array, opts: { contentType?: string | null; origin?: string } = {}) =>
  putImageRoute(request('/api/my/profile/image', {
    method: 'PUT',
    body: new Uint8Array(bytes),
    ...(opts.origin ? { origin: opts.origin } : {}),
    headers: opts.contentType === null ? {} : { 'Content-Type': opts.contentType ?? 'image/png' },
  }));

const deleteImage = (opts: { origin?: string } = {}) =>
  deleteImageRoute(request('/api/my/profile/image', { method: 'DELETE', ...(opts.origin ? { origin: opts.origin } : {}) }));

const avatarCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const signedIn = async (email: string) => {
  const user = await ensureUsername(await createUser({ email }));
  sessionUser.id = user.id;
  return user;
};

describe('PUT /api/my/profile/image', () => {
  it('stores a picture and answers with the address the client should render', async () => {
    const user = await signedIn('mxmx_test_put@example.com');
    const res = await putImage(await png(300, 200));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = await getUserById(user.id);
    expect(row?.image_key).toMatch(/^avatar\/[0-9a-f]{32}$/);
    expect(body).toEqual({ image: `/api/users/${user.id}/avatar?v=${avatarVersion(row!.image_key!)}` });
  });

  it('is session-only and same-site only', async () => {
    expect((await putImage(await png(10, 10))).status).toBe(401);

    await signedIn('mxmx_test_csrf@example.com');
    const crossSite = await putImage(await png(10, 10), { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: 'forbidden' });
  });

  it('answers 413 past the cap without storing anything', async () => {
    const user = await signedIn('mxmx_test_413@example.com');
    const res = await putImage(new Uint8Array(AVATAR_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'image_too_large' });
    expect((await getUserById(user.id))?.image_key).toBeNull();
  });

  it('turns every refusal the store makes into a 400 the client can say out loud', async () => {
    await signedIn('mxmx_test_400@example.com');
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

    const asSvg = await putImage(svg, { contentType: 'image/svg+xml' });
    expect(asSvg.status).toBe(400);
    expect(await asSvg.json()).toEqual({ error: 'unsupported_image' });

    // The same bytes wearing an accepted header: the sniff is what decides.
    const disguised = await putImage(svg, { contentType: 'image/png' });
    expect(disguised.status).toBe(400);
    expect(await disguised.json()).toEqual({ error: 'unsupported_image' });

    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(7)]);
    const unreadable = await putImage(broken);
    expect(unreadable.status).toBe(400);
    expect(await unreadable.json()).toEqual({ error: 'image_unreadable' });

    const untyped = await putImage(await png(10, 10), { contentType: null });
    expect(untyped.status).toBe(400);
    expect(await untyped.json()).toEqual({ error: 'unsupported_image' });
  });
});

describe('DELETE /api/my/profile/image', () => {
  it('takes the picture away and says so; an account with none is still fine', async () => {
    const user = await signedIn('mxmx_test_delete@example.com');
    await putImage(await png(40, 40));
    expect((await getUserById(user.id))?.image_key).not.toBeNull();

    const res = await deleteImage();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: null });
    expect((await getUserById(user.id))?.image_key).toBeNull();

    expect((await deleteImage()).status).toBe(200);
  });

  it('refuses a signed-out caller and a cross-site one', async () => {
    expect((await deleteImage()).status).toBe(401);
    await signedIn('mxmx_test_delete_csrf@example.com');
    expect((await deleteImage({ origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('GET /api/users/<id>/avatar', () => {
  it('serves the WebP to anyone, immutable only at the address the row names', async () => {
    const user = await signedIn('mxmx_test_serve@example.com');
    await putImage(await png(300, 300));
    const version = avatarVersion((await getUserById(user.id))!.image_key!);
    sessionUser.id = ''; // a stranger; the picture is public like the handle

    const matching = await getAvatar(request(`/api/users/${user.id}/avatar?v=${version}`), avatarCtx(user.id));
    expect(matching.status).toBe(200);
    expect(matching.headers.get('Content-Type')).toBe('image/webp');
    expect(matching.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(matching.headers.get('Content-Disposition')).toBe('inline');
    expect(matching.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const served = Buffer.from(await matching.arrayBuffer());
    expect((await sharp(served).metadata()).format).toBe('webp');

    for (const query of ['', '?v=stale', `?v=${version}x`]) {
      const stale = await getAvatar(request(`/api/users/${user.id}/avatar${query}`), avatarCtx(user.id));
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Cache-Control')).toBe('no-cache');
    }
  });

  it('404s for an unknown id and for a person who has no picture', async () => {
    const user = await signedIn('mxmx_test_nopic@example.com');
    expect((await getAvatar(request('/api/users/usr_nobody/avatar'), avatarCtx('usr_nobody'))).status).toBe(404);
    expect((await getAvatar(request(`/api/users/${user.id}/avatar`), avatarCtx(user.id))).status).toBe(404);
  });
});

describe('GET/PATCH /api/my/profile', () => {
  it('carries the picture address and whether the welcome page is still pending', async () => {
    const user = await signedIn('mxmx_test_shape@example.com');
    expect(await (await getProfile(request('/api/my/profile'))).json()).toMatchObject({
      username: user.username, image: null, welcome_pending: false,
    });

    await putImage(await png(60, 60));
    const version = avatarVersion((await getUserById(user.id))!.image_key!);
    expect(await (await getProfile(request('/api/my/profile'))).json()).toMatchObject({
      image: `/api/users/${user.id}/avatar?v=${version}`,
    });
  });

  it('accepts welcome_pending: false, alone or beside a handle, and only false', async () => {
    const user = await signedIn('mxmx_test_confirm@example.com');
    const pending = async () => (await getDb()).query('UPDATE users SET welcome_pending = true WHERE id = $1', [user.id]);
    await pending();
    expect((await getUserById(user.id))?.welcome_pending).toBe(true);

    const both = await patchProfile(request('/api/my/profile', { method: 'PATCH', json: { username: 'confirmed_name', welcome_pending: false } }));
    expect(both.status).toBe(200);
    expect(await both.json()).toMatchObject({ username: 'confirmed_name', welcome_pending: false });
    const after = await getUserById(user.id);
    expect(after?.username).toBe('confirmed_name');
    expect(after?.welcome_pending).toBe(false);

    const alone = await patchProfile(request('/api/my/profile', { method: 'PATCH', json: { welcome_pending: false } }));
    expect(alone.status).toBe(200);
    expect(await alone.json()).toEqual({ welcome_pending: false });

    for (const value of [true, 'false', null, 0]) {
      const refused = await patchProfile(request('/api/my/profile', { method: 'PATCH', json: { welcome_pending: value } }));
      expect(refused.status).toBe(400);
    }
    // A rename that fails takes the confirmation down with it: one body, one
    // answer, and nothing half-applied.
    const other = await ensureUsername(await createUser({ email: 'mxmx_test_taken@example.com' }));
    await pending();
    const clash = await patchProfile(request('/api/my/profile', { method: 'PATCH', json: { username: other.username, welcome_pending: false } }));
    expect(clash.status).toBe(409);
    expect((await getUserById(user.id))?.welcome_pending).toBe(true);
  });
});
