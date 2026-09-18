/**
 * PUT/DELETE /api/my/profile/image — the account's own profile picture, as RAW
 * BYTES.
 *
 * No multipart, no base64 envelope: the browser hands the `File` straight to
 * `fetch` and the `Content-Type` is the file's own, which is the same shape the
 * raw image-upload door already uses. The header is REQUIRED and is still not
 * believed — `lib/avatars` sniffs the bytes — but a caller that names no type
 * at all has not made a request this door can answer.
 *
 * Cookie-authenticated, so it is same-site only: a cross-site page riding the
 * session is CSRF, exactly as the sibling PATCH treats it.
 *
 * The body is read against the cap as it ARRIVES. A `Content-Length` is a
 * claim, not a measurement, so the count that matters is of bytes actually
 * taken: past the cap the read is cancelled and the answer is 413, and nothing
 * over 5 MB + 1 is ever held in memory.
 */
import { auth } from '@/auth';
import { AVATAR_MAX_BYTES, AvatarError, avatarUrl, clearAvatar, setAvatar } from '@/lib/avatars';
import { isCrossSiteRequest, json, unauthorized } from '@/lib/http';
import { getUserById } from '@/lib/users';

const tooLarge = () => json({ error: 'image_too_large' }, 413);

/** The body, or the refusal — never more than one byte past the cap. */
async function readUpload(request: Request): Promise<Buffer | Response> {
  if (Number(request.headers.get('content-length')) > AVATAR_MAX_BYTES) return tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Keep at most one byte past the cap: enough to KNOW it was exceeded,
      // never enough for a hostile body to cost us memory.
      const room = AVATAR_MAX_BYTES + 1 - size;
      const kept = value.byteLength <= room ? value : value.subarray(0, room);
      chunks.push(kept);
      size += kept.byteLength;
      if (size > AVATAR_MAX_BYTES) { await reader.cancel(); return tooLarge(); }
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

/** Session + same-site, the two checks both verbs share. */
async function owner(request: Request): Promise<string | Response> {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  return session.user.id;
}

export async function PUT(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;

  const bytes = await readUpload(request);
  if (bytes instanceof Response) return bytes;

  try {
    await setAvatar(userId, bytes, request.headers.get('content-type') ?? '');
  } catch (error) {
    // Every refusal this module makes is the person's to fix, so each one is
    // their status and their word — never a 500. Only the cap is a 413; a
    // body that got this far past it did not come through readUpload.
    if (error instanceof AvatarError) return json({ error: error.code }, error.code === 'image_too_large' ? 413 : 400);
    throw error;
  }

  const user = await getUserById(userId);
  return json({ image: user ? avatarUrl(user) : null });
}

export async function DELETE(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;
  await clearAvatar(userId);
  return json({ image: null });
}
