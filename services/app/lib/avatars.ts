/**
 * THE PROFILE PICTURE, AS AN ADDRESS.
 *
 * A person's picture is one object in the store, keyed `avatar/<userId>/<sha256>` and
 * recorded on their `users.image_key`. This module is the ONE place that key
 * becomes a URL, so every renderer — a DataTable cell, `<UserImage>`, the
 * account page, the public profile — agrees on it, and the serving route
 * (`app/api/users/[id]/avatar`) is the one place the URL becomes bytes.
 *
 * The address carries the content hash as `?v=`: the route answers with an
 * immutable cache lifetime only when it matches the row, so a replaced picture
 * is asked for at an address no browser has cached, while an old link still
 * resolves to whatever the person has now.
 *
 * Storing, re-encoding and clearing a picture belong here too (M2 of the
 * profiles plan), so that the ONE place a picture becomes bytes-on-disk is the
 * same module the address comes from: the key, the re-encode and the URL are a
 * single decision, and a caller can neither store an un-re-encoded upload nor
 * invent a second address for one.
 */
import sharp from 'sharp';
import { getDb } from './db';
import { objectKey, objectStore, type ObjectStore } from './object-store';
import { sniffImageType } from './web-ingest/sniff';

/** Where a person's picture is served from; public by id, like the handle. */
export const avatarPath = (userId: string): string => `/api/users/${encodeURIComponent(userId)}/avatar`;

/** The version the address carries: the hash part of the object key. */
export const avatarVersion = (imageKey: string): string => imageKey.slice(imageKey.lastIndexOf('/') + 1);

/**
 * The public URL of a person's picture, or null when they have none (the
 * client draws a generated initial instead — never a broken image).
 */
export function avatarUrl(row: { id: string; image_key: string | null }): string | null {
  if (!row.image_key) return null;
  return `${avatarPath(row.id)}?v=${encodeURIComponent(avatarVersion(row.image_key))}`;
}

/**
 * The most a picture may weigh on the way in. It is a HEADSHOT — what leaves
 * here is a 256px WebP of a few kilobytes — so this cap exists to bound the
 * decode, not the stored object: past it the door answers 413 without reading
 * the rest of the body, and nothing reaches sharp.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Why a picture was refused. Each code is a sentence the client already knows how to say. */
export type AvatarErrorCode = 'unsupported_image' | 'image_too_large' | 'image_unreadable';

/** A refusal a door turns into a status; never a 500. */
export class AvatarError extends Error {
  constructor(public readonly code: AvatarErrorCode) {
    super(code);
    this.name = 'AvatarError';
  }
}

/**
 * What a person may upload. SVG is absent BY CONSTRUCTION and not by omission:
 * it is markup, it would be re-encoded by rasterising attacker-authored XML,
 * and a picture that can reference and script is not a picture.
 */
const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
]);

/**
 * AVIF, sniffed here rather than in `lib/web-ingest/sniff`.
 *
 * That module's `sniffImageType` is what `sniffAssetType` and the web-ingest
 * tier decide by, so teaching it a new format would widen what a DOCUMENT may
 * import — a different door with a different cap and its own gates. This one
 * form is local to the avatar door: the ISO-BMFF `ftyp` box at offset 4 with an
 * `avif`/`avis` brand, which is what a phone's photo export actually writes.
 */
const isAvif = (bytes: Buffer): boolean =>
  bytes.length >= 12
  && bytes.subarray(4, 8).toString('latin1') === 'ftyp'
  && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('latin1'));

/** The type the BYTES are, over the type the caller claimed. Null when they are not a picture we take. */
const imageTypeOf = (bytes: Buffer): string | null => {
  const sniffed = sniffImageType(bytes) ?? (isAvif(bytes) ? 'image/avif' : null);
  return sniffed && ACCEPTED_IMAGE_TYPES.has(sniffed) ? sniffed : null;
};

const declaredType = (contentType: string): string => (contentType.split(';')[0] ?? '').trim().toLowerCase();

/**
 * STORE A PERSON'S PICTURE — re-encoded exactly once, on the way in.
 *
 * Everything that arrives leaves as the same thing: a 256×256 WebP. That is
 * what makes the serving route one line and `nosniff` honest (one stored type,
 * decided here, never negotiated), it is what makes an animated GIF a still
 * (sharp reads the first frame unless asked for the rest), and `.rotate()`
 * before the resize is what keeps a phone photograph the right way up — EXIF
 * orientation is dropped by the re-encode, so honouring it afterwards is not
 * an option.
 *
 * The key is content-addressed WITHIN ONE PERSON — `avatar/<userId>/<sha256>`.
 * The person is in the key deliberately: a bare `avatar/<sha256>` is shared by
 * everyone who uploads the same bytes (a default picture, a logo, the same
 * photograph from a shared phone), and then one of them pressing Remove, or
 * replacing theirs, deletes an object the OTHER's row still names — their
 * picture 404s and nothing in either flow says why. Scoping the key makes the
 * delete below provably about this person's object and no one else's. The cost
 * is one duplicate object per person who happens to share bytes, which is the
 * right trade for a 3 KB headshot.
 *
 * Within one person it is still content-addressed, so uploading the same
 * picture twice costs one object and the address does not move; the previous
 * object is deleted only when the key actually changed.
 *
 * `avatarVersion` is unaffected: it reads the LAST path segment, which is the
 * hash either way.
 *
 * `objects` is a seam for tests (the house pattern from lib/story/file-store);
 * every caller in the app takes the default.
 */
export async function setAvatar(
  userId: string,
  bytes: Buffer,
  contentType: string,
  objects: ObjectStore = objectStore(),
): Promise<{ key: string }> {
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError('image_too_large');
  // Two gates, and the second is the one that decides: a declared type we do
  // not take is refused cheaply, and then the BYTES have to agree — a header
  // is the caller's to write, and `image/png` over an SVG is the whole reason
  // this module sniffs at all.
  if (!ACCEPTED_IMAGE_TYPES.has(declaredType(contentType))) throw new AvatarError('unsupported_image');
  if (!imageTypeOf(bytes)) throw new AvatarError('unsupported_image');

  let webp: Buffer;
  try {
    webp = await sharp(bytes).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  } catch {
    // A decoder that gave up on bytes we sniffed as a picture is a broken
    // upload, which is the person's to fix — never this door's 500.
    throw new AvatarError('image_unreadable');
  }

  // The id is the proxy's own `usr_…` off the session, never caller text, so it
  // is a path segment rather than something the object store has to defend.
  const key = objectKey(`avatar/${userId}`, webp);
  await objects.put(key, webp, 'image/webp');
  const db = await getDb();
  const previous = (await db.query<{ image_key: string | null }>('SELECT image_key FROM users WHERE id = $1', [userId]))
    .rows[0]?.image_key ?? null;
  await db.query('UPDATE users SET image_key = $1 WHERE id = $2', [key, userId]);
  // The ROW points at the new object before the old one goes: the reverse
  // order would leave a live row addressing bytes that no longer exist.
  if (previous && previous !== key) await forget(previous, objects);
  return { key };
}

/** Give a person no picture: the column goes null and the object goes away. */
export async function clearAvatar(userId: string, objects: ObjectStore = objectStore()): Promise<void> {
  const db = await getDb();
  const previous = (await db.query<{ image_key: string | null }>('SELECT image_key FROM users WHERE id = $1', [userId]))
    .rows[0]?.image_key ?? null;
  if (!previous) return;
  await db.query('UPDATE users SET image_key = NULL WHERE id = $1', [userId]);
  await forget(previous, objects);
}

/**
 * Delete an object the row no longer points at, and never fail over it: the
 * row is the index, so an object the store has already lost (or never got) is
 * housekeeping we cannot do, not an error the caller can act on.
 */
async function forget(key: string, objects: ObjectStore): Promise<void> {
  try {
    await objects.delete(key);
  } catch {
    // Left for a sweep; the row has already stopped naming it.
  }
}
