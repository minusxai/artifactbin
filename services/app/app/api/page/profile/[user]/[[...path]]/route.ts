/**
 * The pretty-URL page's data. Resolution is FORGIVING and id-anchored: a path
 * whose last segment starts with a valid id names the artifact (the client
 * heals a mangled address to the canonical one — after the ACL, so a private
 * document never leaks its owner); anything else is the same flat public
 * index for every viewer. An UNREADABLE artifact falls through to the listing
 * exactly like a nonexistent one: no existence oracle in the difference.
 *
 * NESTING IS NOT IN THE ADDRESS. A folder is an artifact with its own page,
 * so a trailing path that does not identify an artifact is a uniform 404.
 */
import { canReadArtifact, getArtifactById, type ArtifactSummary } from '@/lib/artifacts';
import { json } from '@/lib/http';
import { count, has } from '@/lib/relations';
import { canonicalArtifactPath, parsePrettyPath } from '@/lib/urls';
import { getUserByUsername, listPublicArtifactsByUser, ownerUsername } from '@/lib/users';
import { browserSessionKind, sessionActor } from '@/lib/viewer';

const decoded = (segment: string): string => { try { return decodeURIComponent(segment); } catch { return segment; } };
export async function GET(request: Request, ctx: { params: Promise<{ user: string; path?: string }> }) {
  const { user, path: rawPath } = await ctx.params;
  const notFound = () => json({ error: 'not_found' }, 404);
  const u = decoded(user);
  if (!u.startsWith('@')) return notFound();
  const handle = u.slice(1).toLowerCase();
  const path = (rawPath ?? '').split('/').filter(Boolean).map(decoded);
  const actor = await sessionActor(request);
  const viewer = actor.viewer;

  const file = parsePrettyPath(path);
  if (file) {
    const artifact = await getArtifactById(file.id);
    if (artifact && (await canReadArtifact(artifact, viewer))) {
      const canonical = canonicalArtifactPath(artifact, await ownerUsername(artifact.user_id));
      const requested = `/@${handle}${path.length ? '/' + path.join('/') : ''}`;
      if (requested !== canonical) return json({ kind: 'redirect', to: canonical });
      return json({ kind: 'artifact', id: artifact.id });
    }
  }

  // Anything left after the id parse is decoration that named nothing. There
  // is no listing below the handle any more, so it is the uniform 404 — the
  // same answer an unreadable id-path falls through to.
  if (path.length > 0) return notFound();
  const owner = await getUserByUsername(handle);
  if (!owner) return notFound();
  // A profile is the same public index for its owner and every visitor.
  // Public folders list alongside documents; private/unlisted work stays out.
  const files = await listPublicArtifactsByUser(owner.id);
  const anon = !viewer && (await browserSessionKind(request)) === 'anon';
  const stranger = !viewer || viewer.userId !== owner.id;
  const relationship = stranger
    ? {
        owner: { id: owner.id },
        follow: {
          following: viewer?.userId ? await has(viewer.userId, 'follow', owner.id) : false,
          count: await count('follow', owner.id),
        },
      }
    : {};
  return json({
    kind: 'public-profile',
    handle,
    ...relationship,
    files: strip(files).map(({ ancestor_ids: _placement, ...card }) => card),
    authed: !!viewer,
    anon,
  });
}

/**
 * What a listing card needs — never `content`/`source`. The two DATES travel
 * too: a card stamps when a document was created, a row when it last moved,
 * and a card with no date reads "Invalid Date" (which is how this was found).
 *
 * PLACEMENT stays private: a public document filed inside a private folder
 * must not hand profile readers that folder's address, which would be
 * breadcrumbs to a uniform 404 and tells them something about a shelf that is
 * not theirs. Ids are addresses and not secrets, so this is a projection rule
 * rather than a hole.
 */
function strip(files: ArtifactSummary[]): Array<Pick<ArtifactSummary, 'id' | 'title' | 'format' | 'ancestor_ids' | 'visibility' | 'updated_at' | 'created_at' | 'version'>> {
  return files.map(({ id, title, format, ancestor_ids, visibility, updated_at, created_at, version }) => ({ id, title, format, ancestor_ids, visibility, updated_at, created_at, version }));
}
