/**
 * A TITLE-SLUG ADDRESS: `/@handle/<title-slug>` names the EARLIEST live page of that owner (an account, or a group by
 * its handle) whose title slugs to it. It is the fallback of the id-anchored grammar (lib/http/urls), asked only once
 * the address's own id names nothing this viewer may read, so every id address costs what it did.
 *
 * A title is guessable where an id is not: a slug resolves to a page that is public, or one the viewer holds a role on
 * WITHOUT the link (owner, a named share, a group). An unlisted page is never found by guessing its title. Pages the
 * viewer may not resolve are skipped, so the answer never tells a stranger that a hidden page exists.
 *
 * One indexed query (lib/platform/schema idx_artifacts_user_slug / idx_artifacts_group_slug), remembered per request:
 * the shell cache, the page's admission and the profile route ask it once between them.
 */
import { canRead } from '@artifactbin/contracts';
import { titleSlug } from '@artifactbin/utils/artifact-reference';
import type { AccessActor } from '@/lib/accounts';
import { roleWithoutLink, type ArtifactRow } from '@/lib/artifact-access';
import { getDb, TITLE_SLUG_SQL } from '@/lib/platform';

type Candidate = Pick<ArtifactRow, 'id' | 'user_id' | 'group_id' | 'visibility' | 'link_role' | 'format' | 'token_id'>;

/** How many same-slug pages one address considers before it gives up: earliest first. */
const CANDIDATES = 20;

const decoded = (segment: string): string => { try { return decodeURIComponent(segment); } catch { return segment; } };

/** `{ handle, slug }` when the path is `/@handle/<slug>` (or its `/edit`), the slug already in titleSlug's form; else null. */
export function slugAddress(pathname: string): { handle: string; slug: string } | null {
  const segments = pathname.replace(/\/edit\/?$/, '').split('/').filter(Boolean).map(decoded);
  if (segments.length !== 2 || !segments[0]!.startsWith('@')) return null;
  const slug = segments[1]!;
  return slug && titleSlug(slug) === slug ? { handle: segments[0]!.slice(1).toLowerCase(), slug } : null;
}

async function resolve(handle: string, slug: string, actor: AccessActor): Promise<string | null> {
  const db = await getDb();
  const columns = 'id, user_id, group_id, visibility, link_role, format, token_id, created_at';
  const { rows } = await db.query<Candidate & { created_at: string }>(
    `(SELECT ${columns} FROM artifacts
       WHERE user_id = (SELECT id FROM users WHERE username = $1) AND group_id IS NULL AND deleted_at IS NULL AND title IS NOT NULL AND ${TITLE_SLUG_SQL} = $2
       ORDER BY created_at, id LIMIT ${CANDIDATES})
     UNION ALL
     (SELECT ${columns} FROM artifacts
       WHERE group_id = (SELECT id FROM groups WHERE handle = $1 AND deleted_at IS NULL) AND group_id IS NOT NULL AND deleted_at IS NULL AND title IS NOT NULL AND ${TITLE_SLUG_SQL} = $2
       ORDER BY created_at, id LIMIT ${CANDIDATES})
     ORDER BY created_at, id`,
    [handle, slug],
  );
  for (const row of rows) {
    if (row.visibility === 'public') return row.id;
    if (canRead(await roleWithoutLink(row, actor))) return row.id;
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
