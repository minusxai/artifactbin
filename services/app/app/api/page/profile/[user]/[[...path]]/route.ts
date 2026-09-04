/**
 * The pretty-URL page's data. Resolution is FORGIVING and id-anchored: a path
 * whose last segment starts with a valid id names the artifact (the client
 * heals a mangled address to the canonical one — after the ACL, so a private
 * document never leaks its owner); anything else is a listing — the owner's
 * folder tree, or a stranger's public index at the root only. An UNREADABLE
 * artifact falls through to the listing exactly like a nonexistent one: no
 * existence oracle in the difference.
 */
import { canReadArtifact, getArtifactById, type ArtifactSummary } from '@/lib/artifacts';
import { json } from '@/lib/http';
import { count, has } from '@/lib/relations';
import { canonicalArtifactPath, parseFolder, parsePrettyPath } from '@/lib/urls';
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

  const folder = parseFolder(path.join('/'));
  if (folder === null) return notFound();
  const owner = await getUserByUsername(handle);
  if (!owner) return notFound();
  if (!viewer || viewer.userId !== owner.id) {
    if (folder !== '') return notFound();
    const files = await listPublicArtifactsByUser(owner.id);
    const anon = !viewer && (await browserSessionKind(request)) === 'anon';
    // The follow control needs the target's ID (the door is keyed by id, not
    // by handle) and the state it renders in. Only on the STRANGER's branch:
    // the owner's own listing below has nobody to follow, and shipping the
    // fields there would be a control the page can never draw.
    const follow = {
      following: viewer?.userId ? await has(viewer.userId, 'follow', owner.id) : false,
      count: await count('follow', owner.id),
    };
    return json({ kind: 'public-profile', handle, owner: { id: owner.id }, follow, files: strip(files), email: viewer?.email ?? null, authed: !!viewer, anon });
  }
  const all = await listArtifactsByUser(owner.id);
  const files = all.filter((a) => a.folder === folder);
  const prefix = folder ? `${folder}/` : '';
  const children = [...new Set(all.filter((a) => a.folder.startsWith(prefix) && a.folder !== folder).map((a) => a.folder.slice(prefix.length).split('/')[0]))].sort();
  // A folder exists only through the artifacts that carry it, so one holding
  // nothing — no files, no children — is an address that names nothing: the
  // uniform 404 (which is also where an unreadable id-path lands after it
  // falls through to here). The ROOT stays a page when empty: a brand-new
  // account's dashboard is a real, if bare, place.
  if (folder !== '' && files.length === 0 && children.length === 0) return notFound();
  return json({
    kind: 'owner-listing', handle, folder, folders: children.map((c) => `${prefix}${c}`),
    files: strip(files), total: all.length, stats: statsOf(all), email: viewer.email,
  });
}

/**
 * What a listing card needs — never `content`/`source`. The two DATES travel
 * too: a card stamps when a document was created, a row when it last moved,
 * and a card with no date reads "Invalid Date" (which is how this was found).
 */
function strip(files: ArtifactSummary[]): Array<Pick<ArtifactSummary, 'id' | 'title' | 'format' | 'folder' | 'visibility' | 'updated_at' | 'created_at' | 'version'>> {
  return files.map(({ id, title, format, folder, visibility, updated_at, created_at, version }) => ({ id, title, format, folder, visibility, updated_at, created_at, version }));
}
