import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { AVATAR_MAX_BYTES, AvatarError, avatarPath, avatarUrl, avatarVersion, clearAvatar, setAvatar } from '@/lib/avatars';
import { createLocalStore, ObjectUnavailable, type ObjectStore } from '@/lib/object-store';
import { createUser, getUserById } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

/** A store of this file's own, so a re-encode in a test never lands in the app's object directory. */
const scratchStore = async (): Promise<ObjectStore> => createLocalStore(await mkdtemp(path.join(tmpdir(), 'avatars-')));

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();
const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg({ quality: 90 }).toBuffer();
const gif = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 200, b: 100 } } }).gif().toBuffer();

const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

describe('avatarUrl (pure)', () => {
  it('is null for a person with no picture', () => {
    expect(avatarUrl({ id: 'usr_abc', image_key: null })).toBeNull();
  });

  it('addresses the serving route by id and carries the content hash as v', () => {
    const key = 'avatar/' + 'a'.repeat(64);
    expect(avatarVersion(key)).toBe('a'.repeat(64));
    expect(avatarUrl({ id: 'usr_abc', image_key: key })).toBe(`${avatarPath('usr_abc')}?v=${'a'.repeat(64)}`);
    expect(avatarPath('usr_abc')).toBe('/api/users/usr_abc/avatar');
  });
});

describe('setAvatar', () => {
  it('re-encodes whatever arrives to a 256x256 WebP and records the key on the row', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_avatar@example.com' });
    const { key } = await setAvatar(user.id, await jpeg(900, 400), 'image/jpeg', store);

    expect(key).toMatch(/^avatar\/[0-9a-f]{32}$/);
    expect((await getUserById(user.id))?.image_key).toBe(key);
    const stored = await store.get(key);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('takes an animated GIF (its first frame) and a PNG alike', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_gif@example.com' });
    for (const [bytes, type] of [[await gif(64, 64), 'image/gif'], [await png(64, 64), 'image/png']] as const) {
      const { key } = await setAvatar(user.id, bytes, type, store);
      expect((await sharp(await store.get(key)).metadata()).format).toBe('webp');
    }
  });

  it('refuses SVG — by the declared type AND by the bytes, which is the one that matters', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_svg@example.com' });
    await expect(setAvatar(user.id, SVG_BYTES, 'image/svg+xml', store)).rejects.toMatchObject({ code: 'unsupported_image' });
    // The header is the caller's to choose; the bytes are not.
    await expect(setAvatar(user.id, SVG_BYTES, 'image/png', store)).rejects.toMatchObject({ code: 'unsupported_image' });
    expect((await getUserById(user.id))?.image_key).toBeNull();
  });

  it('refuses anything past the cap before it decodes', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_big@example.com' });
    const oversize = Buffer.concat([await png(8, 8), Buffer.alloc(AVATAR_MAX_BYTES)]);
    const refusal = await setAvatar(user.id, oversize, 'image/png', store).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AvatarError);
    expect((refusal as AvatarError).code).toBe('image_too_large');
  });

  it('refuses bytes that will not decode, however they are labelled', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_broken@example.com' });
    // A real PNG signature over noise: it sniffs as PNG and dies in the decoder.
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    await expect(setAvatar(user.id, broken, 'image/png', store)).rejects.toMatchObject({ code: 'image_unreadable' });
  });

  it('deletes the picture it replaced', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_replace@example.com' });
    const first = await setAvatar(user.id, await png(70, 70), 'image/png', store);
    const second = await setAvatar(user.id, await jpeg(120, 60), 'image/jpeg', store);
    expect(second.key).not.toBe(first.key);
    expect((await getUserById(user.id))?.image_key).toBe(second.key);
    await expect(store.get(first.key)).rejects.toBeInstanceOf(ObjectUnavailable);
    await expect(store.get(second.key)).resolves.toBeInstanceOf(Buffer);
  });

  it('keeps the object when the same bytes are uploaded twice (the key does not move)', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_same@example.com' });
    const bytes = await png(50, 50);
    const first = await setAvatar(user.id, bytes, 'image/png', store);
    const again = await setAvatar(user.id, bytes, 'image/png', store);
    expect(again.key).toBe(first.key);
    await expect(store.get(first.key)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('clearAvatar', () => {
  it('nulls the column and deletes the object; a person with none is a no-op', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_clear@example.com' });
    const { key } = await setAvatar(user.id, await png(40, 40), 'image/png', store);

    await clearAvatar(user.id, store);
    expect((await getUserById(user.id))?.image_key).toBeNull();
    await expect(store.get(key)).rejects.toBeInstanceOf(ObjectUnavailable);

    await expect(clearAvatar(user.id, store)).resolves.toBeUndefined();
  });

  it('survives an object the store has already lost', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_lost@example.com' });
    const { key } = await setAvatar(user.id, await png(40, 40), 'image/png', store);
    await store.delete(key);
    await expect(clearAvatar(user.id, store)).resolves.toBeUndefined();
    expect((await getUserById(user.id))?.image_key).toBeNull();
  });
});

describe('what the re-encode costs', () => {
  it('turns a ~12 MP photograph into a 256px WebP inside a request budget', async () => {
    const store = await scratchStore();
    const user = await createUser({ email: 'mxmx_test_timing@example.com' });
    // 12.0 MP, what a phone camera hands over — and DETAILED, not a flat
    // fill: a single-colour frame of the same dimensions encodes to 70 KB and
    // decodes in a fraction of the time, which would measure nothing.
    const photo = await sharp(randomBytes(4000 * 3000 * 3), { raw: { width: 4000, height: 3000, channels: 3 } })
      .blur(3).jpeg({ quality: 88 }).toBuffer();
    const started = performance.now();
    const { key } = await setAvatar(user.id, photo, 'image/jpeg', store);
    const ms = performance.now() - started;
    const encoded = await store.get(key);
    // Recorded for the report; the assertion is the ceiling, not the measurement.
    console.log(`[avatar] 12 MP JPEG (${photo.length} bytes) -> 256px WebP (${encoded.length} bytes) in ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(5000);
    expect(encoded.length).toBeLessThan(40 * 1024);
    expect(photo.length).toBeGreaterThan(1024 * 1024);
  });
});
