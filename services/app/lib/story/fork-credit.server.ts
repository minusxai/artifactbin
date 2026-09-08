import { getArtifactById } from '@/lib/artifacts';
import { canonicalArtifactPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import type { ReaderForkedFrom } from './reader-chrome';

/**
 * WHERE THIS COPY CAME FROM, as the credit line may say it.
 *
 * The test is VISIBILITY — `public`, exactly — and deliberately NOT "may a
 * stranger read it". `unlisted` is stranger-readable, which is the whole tier,
 * but it exists to be listed NOWHERE: naming it here republishes its canonical
 * address in the credits of every public fork, and the person who forked is not
 * the person who chose the tier. Measured before this rule existed: an owner
 * who narrowed a source to `unlisted` after someone forked it kept handing the
 * full linked address to every stranger reading the copy.
 *
 * So there is ONE branch, and everything that is not public takes it —
 * unlisted, private, and gone alike, with no link and no id. That is also what
 * keeps the line from being an existence oracle: a reader has nothing here to
 * tell those three apart with.
 *
 * Resolved per render rather than per viewer, and never written into the
 * markup: an agent that rewrites the document cannot delete the attribution,
 * and nothing about the source is baked into bytes that outlive its ACL.
 */
const NOT_PUBLIC_SOURCE = { label: 'a document that is not public', href: null } as const;

export async function forkedFromCredit(sourceId: string | null): Promise<ReaderForkedFrom | null> {
  if (!sourceId) return null;
  const source = await getArtifactById(sourceId);
  if (!source || source.visibility !== 'public') return NOT_PUBLIC_SOURCE;
  const href = canonicalArtifactPath(source, await ownerUsername(source.user_id));
  return { label: href.replace(/^\//, ''), href };
}
