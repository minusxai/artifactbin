/**
 * THE PROFILE PICTURE, AS AN ADDRESS.
 *
 * A person's picture is one object in the store, keyed `avatar/<sha256>` and
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
 * profiles plan); this seed carries only the address.
 */

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
