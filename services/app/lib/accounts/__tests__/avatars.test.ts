/** Profile pictures: refused before decoding when too large or not a picture, stored once as a per-person WebP, cleared cleanly. */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { useAppHarness } from '@/__tests__/harness';
import { AVATAR_MAX_BYTES, AvatarError, avatarPath, avatarUrl, avatarVersion, clearAvatar, createUser, getUserById, setAvatar } from '@/lib/accounts';
import { PUBLIC_BASE_URL } from '@/lib/platform/config';

useAppHarness();

type Objects = Parameters<typeof setAvatar>[3];
/** An in-memory object store recording deletes; `failDeletes` makes every delete throw. */
function memoryStore(failDeletes = false) {
  const objects = new Map<string, Buffer>(), deleted: string[] = [];
  const store = {
    backend: 'local',
    async put(key: string, body: Buffer | string) { objects.set(key, Buffer.from(body)); },
    async get(key: string) { const found = objects.get(key); if (!found) throw new Error('missing'); return found; },
    async delete(key: string) { deleted.push(key); if (failDeletes) throw new Error('store down'); objects.delete(key); },
  } as unknown as Objects;
  return { store, objects, deleted };
}
const png = (red: number) => sharp({ create: { width: 4, height: 2, channels: 3, background: { r: red, g: 0, b: 0 } } }).png().toBuffer();
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof AvatarError ? error.code : error));

describe('addresses', () => {
  it('serves a picture by user id, versioned by its hash; no picture has no address', () => {
    expect(avatarPath('usr_a/b')).toBe('/api/users/usr_a%2Fb/avatar');
    expect(avatarVersion('avatar/usr_1/abc123')).toBe('abc123');
    expect(avatarUrl({ id: 'usr_1', image_key: null })).toBeNull();
    expect(avatarUrl({ id: 'usr_1', image_key: 'avatar/usr_1/abc123' })).toBe(new URL('/api/users/usr_1/avatar?v=abc123', PUBLIC_BASE_URL).href);
  });
});

describe('setAvatar', () => {
  it('refuses oversize, undeclared, mislabelled and undecodable uploads without storing anything', async () => {
    const user = await createUser({ email: 'face@example.test' });
    const { store, objects } = memoryStore();
    const real = await png(255);
    expect(AVATAR_MAX_BYTES).toBe(50_000_000);
    expect(await refusal(setAvatar(user.id, Buffer.alloc(AVATAR_MAX_BYTES + 1), 'image/png', store))).toBe('image_too_large');
    expect(await refusal(setAvatar(user.id, real, 'image/svg+xml', store))).toBe('unsupported_image');
    expect(await refusal(setAvatar(user.id, real, 'text/plain', store))).toBe('unsupported_image');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await refusal(setAvatar(user.id, svg, 'image/png', store))).toBe('unsupported_image');
    const truncated = Buffer.concat([real.subarray(0, 8), Buffer.from('not really a png')]);
    expect(await refusal(setAvatar(user.id, truncated, 'image/png; charset=binary', store))).toBe('image_unreadable');
    expect(objects.size).toBe(0);
    expect((await getUserById(user.id))!.image_key).toBeNull();
  });

  it('stores a 256px WebP under the person\'s own content key; same bytes keep it, new bytes replace and delete the old', async () => {
    const user = await createUser({ email: 'face@example.test' });
    const { store, objects, deleted } = memoryStore();
    const { key } = await setAvatar(user.id, await png(255), 'IMAGE/PNG', store);
    expect(key).toMatch(new RegExp(`^avatar/${user.id}/[0-9a-f]{32}$`));
    expect((await getUserById(user.id))!.image_key).toBe(key);
    expect(await sharp(objects.get(key)!).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect((await setAvatar(user.id, await png(255), 'image/png', store)).key).toBe(key);
    expect(deleted).toEqual([]);
    const next = (await setAvatar(user.id, await png(10), 'image/png', store)).key;
    expect(next).not.toBe(key);
    expect(deleted).toEqual([key]);
    expect([...objects.keys()]).toEqual([next]);
  });

  it('keys by person, so two people with the same picture never share an object', async () => {
    const a = await createUser({ email: 'a@example.test' }), b = await createUser({ email: 'b@example.test' });
    const { store } = memoryStore();
    const bytes = await png(255);
    const keyA = (await setAvatar(a.id, bytes, 'image/png', store)).key, keyB = (await setAvatar(b.id, bytes, 'image/png', store)).key;
    expect(keyA).not.toBe(keyB);
    expect(avatarVersion(keyA)).toBe(avatarVersion(keyB));
  });
});

describe('clearAvatar', () => {
  it('nulls the column and deletes the object; with none it does nothing; a failing delete never fails the clear', async () => {
    const user = await createUser({ email: 'face@example.test' });
    const { store, objects, deleted } = memoryStore();
    const { key } = await setAvatar(user.id, await png(255), 'image/png', store);
    await clearAvatar(user.id, store);
    expect((await getUserById(user.id))!.image_key).toBeNull();
    expect(objects.size).toBe(0);
    expect(deleted).toEqual([key]);
    await clearAvatar(user.id, store);
    expect(deleted).toEqual([key]);
    const broken = memoryStore(true);
    await setAvatar(user.id, await png(255), 'image/png', broken.store);
    await expect(clearAvatar(user.id, broken.store)).resolves.toBeUndefined();
    expect((await getUserById(user.id))!.image_key).toBeNull();
  });
});
