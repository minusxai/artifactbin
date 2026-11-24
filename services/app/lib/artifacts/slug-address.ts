/**
 * A TITLE-SLUG ADDRESS: `/@handle/<title-slug>` names the EARLIEST live page of that owner (an account, or a group by
 * its handle) whose title slugs to it. It is the fallback of the id-anchored grammar (lib/http/urls), asked only once
 * the address's own id names nothing this viewer may read, so every id address costs what it did.
 *
 * The earliest page decides, for every viewer alike: an address never means one page to its owner and another to the
 * people it is shared with. A title is guessable where an id is not, so that page is served only when it is public or the
 * viewer holds a role on it WITHOUT the link (owner, a named share, a group); otherwise the address is the uniform 404,
 * the same answer as no page at all. An unlisted page is never found by guessing its title.
 *
 * One indexed query per segment (lib/platform/schema idx_artifacts_user_slug / idx_artifacts_group_slug), remembered per request:
 * the shell cache, the page's admission and the profile route ask it once between them.
 */
import { canRead } from '@artifactbin/contracts/sharing';
import { titleSlug } from '@artifactbin/utils/artifact-reference';
import type { AccessActor } from '@/lib/accounts';
import { roleWithoutLink, type ArtifactRow } from '@/lib/artifact-access';
import { getDb, TITLE_SLUG_SQL } from '@/lib/platform';

type Candidate = Pick<ArtifactRow, 'id' | 'user_id' | 'group_id' | 'visibility' | 'link_role' | 'format' | 'token_id'>;

const decoded = (segment: string): string => { try { return decodeURIComponent(segment); } catch { return segment; } };

/** `{ handle, slug }` when the path is `/@handle/<slug>` (or its `/edit`), the slug in titleSlug's form but for case; else null. */
export function slugAddress(pathname: string): { handle: string; slug: string } | null {
  const segments = pathname.replace(/\/edit\/?$/, '').split('/').filter(Boolean).map(decoded);
  if (segments.length < 2 || !segments[0]!.startsWith('@')) return null;
  const parts = segments.slice(1).map(s => s.toLowerCase());
  const slug = parts.join('/');
  return parts.every(s => s && titleSlug(s) === s) ? { handle: segments[0]!.slice(1).toLowerCase(), slug } : null;
}

async function resolve(handle: string, slug: string, actor: AccessActor): Promise<string | null> {
  const db = await getDb();
  const columns = 'id, user_id, group_id, visibility, link_role, format, token_id, created_at';
  const parts = slug.split('/');
  const root = parts.length > 1 ? "AND ancestor_ids='{}' AND format='folder'" : '';
  const matches = `deleted_at IS NULL AND title IS NOT NULL AND ${TITLE_SLUG_SQL}=$2`;
  const first = await db.query<Candidate>(
    `(SELECT ${columns} FROM artifacts WHERE user_id=(SELECT id FROM users WHERE username=$1)
       AND group_id IS NULL AND ${matches} ${root} ORDER BY created_at,id LIMIT 1)
     UNION ALL
     (SELECT ${columns} FROM artifacts WHERE group_id=(SELECT id FROM groups WHERE handle=$1 AND deleted_at IS NULL)
       AND group_id IS NOT NULL AND ${matches} ${root} ORDER BY created_at,id LIMIT 1)
     ORDER BY created_at,id LIMIT 1`, [handle, parts[0]],
  );
  let row = first.rows[0];
  const ancestors: string[] = [];
  for (let index=0; row; index++) {
    if (row.visibility !== 'public' && !canRead(await roleWithoutLink(row,actor))) return null;
    if (index === parts.length-1) return row.id;
    ancestors.push(row.id);
    const ownership = row.group_id ? 'group_id=$1' : 'user_id=$1 AND group_id IS NULL';
    const folder = index+2 < parts.length ? "AND format='folder'" : '';
    const child = await db.query<Candidate>(
      `SELECT ${columns} FROM artifacts WHERE ${ownership} AND ${matches} AND ancestor_ids=$3::text[]
       ${folder} ORDER BY created_at,id LIMIT 1`, [row.group_id ?? row.user_id, parts[index+1], ancestors],
    );
    row = child.rows[0];
  }
  return null;
}

const asked = new WeakMap<Request, Map<string, Promise<string | null>>>();

/**
 * The id `/@handle/<title-slug>` names for this request's viewer, or null. The caller still admits the row as it
 * admits any id: this only picks which page the address means.
 */
export function slugAddressTarget(request: Request, pathname: string, actor: AccessActor): Promise<string | null> {
  const address = slugAddress(pathname);
  if (!address) return Promise.resolve(null);
  let memo = asked.get(request);
  if (!memo) asked.set(request, (memo = new Map()));
  const key = `${address.handle}/${address.slug}/${actor.userId ?? ''}`;
  let found = memo.get(key);
  if (!found) memo.set(key, (found = resolve(address.handle, address.slug, actor)));
  return found;
}
