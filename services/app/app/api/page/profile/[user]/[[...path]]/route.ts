/**
 * The pretty-URL page's data. Resolution is FORGIVING and id-anchored: a path
 * whose last segment starts with a valid id names the artifact (the client
 * heals a mangled address to the canonical one — after the ACL, so a private
 * document never leaks its owner); the bare handle is a listing — the owner's
 * ROOT, or a stranger's public index. An UNREADABLE artifact falls through to
 * the listing exactly like a nonexistent one: no existence oracle in the
 * difference.
 *
 * NESTING IS NOT IN THE ADDRESS. A folder is an artifact with its own page
 * (its `<Files>` listing IS the folder), so there is no folder branch here and
 * no path grammar to parse: any trailing segment that does not carry an id is
 * the uniform 404. The owner's root is the rows at level 0 — folders included,
 * as ordinary rows with `format: 'folder'`.
 */
import { canReadArtifact, getArtifactById, type ArtifactSummary } from '@/lib/artifacts';
import { json } from '@/lib/http';
import { canonicalArtifactPath, parsePrettyPath } from '@/lib/urls';
import { getUserByUsername, listArtifactsByUser, listPublicArtifactsByUser, ownerUsername } from '@/lib/users';
import { browserSessionKind, sessionActor } from '@/lib/viewer';

const decoded = (segment: string): string => { try { return decodeURIComponent(segment); } catch { return segment; } };
const statsOf = (artifacts: { format: string }[]) => {
  const formats: Record<string, number> = { markup: 0 };
  for (const a of artifacts) formats[a.format] = (formats[a.format] ?? 0) + 1;
  return { total: artifacts.length, formats };
};

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
  if (!viewer || viewer.userId !== owner.id) {
    const files = await listPublicArtifactsByUser(owner.id);
    const anon = !viewer && (await browserSessionKind(request)) === 'anon';
    return json({ kind: 'public-profile', handle, files: strip(files).map(({ ancestor_ids: _placement, ...card }) => card), email: viewer?.email ?? null, authed: !!viewer, anon });
  }
  const all = await listArtifactsByUser(owner.id);
  // The ROOT: everything at level 0, folders among them as ordinary rows. A
  // brand-new account's is a real, if bare, place — never a 404.
  const files = all.filter((a) => (a.ancestor_ids ?? []).length === 0);
  return json({
    kind: 'owner-listing', handle,
    files: strip(files), total: all.length, stats: statsOf(all), email: viewer.email,
  });
}

/**
 * What a listing card needs — never `content`/`source`. The two DATES travel
 * too: a card stamps when a document was created, a row when it last moved,
 * and a card with no date reads "Invalid Date" (which is how this was found).
 *
 * PLACEMENT is the one field the two branches do NOT share: the owner's
 * listing draws the shelf from `ancestor_ids`, while a stranger's index of
 * public documents drops it — a public document filed inside a private folder
 * would otherwise hand every reader that folder's address, which is
 * breadcrumbs to a uniform 404 and tells them something about a shelf that is
 * not theirs. Ids are addresses and not secrets, so this is a projection rule
 * rather than a hole; it is here because the alternative is a sentence in a
 * doc-comment that the code contradicts.
 */
function strip(files: ArtifactSummary[]): Array<Pick<ArtifactSummary, 'id' | 'title' | 'format' | 'ancestor_ids' | 'visibility' | 'updated_at' | 'created_at' | 'version'>> {
  return files.map(({ id, title, format, ancestor_ids, visibility, updated_at, created_at, version }) => ({ id, title, format, ancestor_ids, visibility, updated_at, created_at, version }));
}
