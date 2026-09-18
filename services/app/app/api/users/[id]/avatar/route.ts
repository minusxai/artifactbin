/**
 * GET /api/users/<id>/avatar — a person's picture, PUBLIC by id.
 *
 * Public because the handle is: `/@name` is a page anyone may open, and a
 * profile whose picture 403'd for visitors would be a profile with a broken
 * image on it. The id is the whole input and it is only ever a row lookup.
 *
 * ONE STORED TYPE. `lib/avatars` re-encodes every upload to WebP, so the type
 * here is a constant rather than something read back from a row — which is
 * what makes `nosniff` an honest promise and not a guess.
 *
 * THE CACHE LIFETIME IS EARNED BY THE ADDRESS. `?v=` carries the content hash
 * (`avatarVersion`); when it matches what the row holds now, the bytes at that
 * address can never change and the answer is immutable for a year. Any other
 * address — no `v`, a stale one, a guess — is still SERVED, with `no-cache`,
 * so an old link in a document shows whatever the person has today rather than
 * breaking. A replaced picture is therefore asked for at an address no browser
 * has seen.
 */
import { avatarVersion } from '@/lib/avatars';
import { objectStore } from '@/lib/object-store';
import { getUserById } from '@/lib/users';

const notFound = () => new Response('not found', { status: 404 });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUserById(id);
  // An unknown id and a person with no picture are the SAME answer: a profile
  // picture is not an existence oracle for accounts.
  if (!user?.image_key) return notFound();

  let bytes: Buffer;
  try {
    // `get`, not `getStream`: this object is a few kilobytes and immutable, so
    // it is exactly what the store's read cache exists for — a popular
    // profile's picture is fetched once.
    bytes = await objectStore().get(user.image_key);
  } catch {
    // A row promising bytes the store will not give is our fault, but this is
    // a public address and a 500 here would turn it into their broken page.
    return notFound();
  }

  const fresh = new URL(request.url).searchParams.get('v') === avatarVersion(user.image_key);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      // A picture, shown in place — never a download, and never a page.
      'Content-Disposition': 'inline',
      'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}
