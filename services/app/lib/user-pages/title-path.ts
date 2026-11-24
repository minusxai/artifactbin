/** Construct a mount-relative address only from verified public placements. The same expression
 * resolves incoming titles and constructs links, including collisions in intermediate folders. */
import { ARTIFACT_SEGMENT_PATTERN } from '@artifactbin/contracts/artifact-reference';
import { getDb, TITLE_SLUG_SQL } from '@/lib/platform';
import type { UserPagesOwner } from './hosts';
import { publicSiteAncestors } from './site-roots';

const reserved = new Set(['a', 'af', 'api', 'assets', 'folders']);
const slugOf = (alias: string) => TITLE_SLUG_SQL.replace(/\btitle\b/g, alias + '.title');

export function usableSitePath(path: string | null): string | null {
  return path && !reserved.has(path.split('/')[1]!) ? path : null;
}

/** Outer row a has already passed publicSiteAncestors. root is a bound nullable folder ID. */
export function siteTitlePathSql(kind: UserPagesOwner['kind'], root: string) {
  const owner = kind === 'group' ? 's.group_id=$1' : 's.user_id=$1 AND s.group_id IS NULL';
  return `(SELECT CASE WHEN bool_and(part.slug <> '' AND NOT EXISTS (
      SELECT FROM artifacts s WHERE ${owner} AND s.ancestor_ids=p.ancestor_ids AND s.id<>p.id
        AND s.deleted_at IS NULL AND s.visibility='public' AND s.format IN ('html','folder')
        AND s.title IS NOT NULL AND ${slugOf('s')}=part.slug))
      AND NOT (count(*)=1 AND EXISTS (SELECT FROM artifacts stable WHERE stable.deleted_at IS NULL
        AND stable.format='html' AND stable.visibility IN ('public','unlisted')
        AND stable.id=substring(${slugOf('a')} from '${ARTIFACT_SEGMENT_PATTERN.source}')))
    THEN '/' || string_agg(part.slug,'/' ORDER BY chain.depth) END
    FROM unnest(a.ancestor_ids || a.id) WITH ORDINALITY chain(id,depth)
    JOIN artifacts p ON p.id=chain.id
    CROSS JOIN LATERAL (SELECT ${slugOf('p')} AS slug) part
    WHERE chain.depth>coalesce(array_position(a.ancestor_ids,${root}::text),0))`;
}

export async function siteTitleTarget(owner: UserPagesOwner, path: string) {
  const parts = path.slice(1).split('/');
  if (!usableSitePath(path) || !parts.every(part => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part) && part.length<=60)) return null;
  const ownership = owner.kind==='group' ? 'a.group_id=$1' : 'a.user_id=$1 AND a.group_id IS NULL';
  return (await (await getDb()).query<{id:string;format:string}>(`SELECT id,format FROM artifacts a
    WHERE ${ownership} AND a.visibility='public' AND a.deleted_at IS NULL AND a.title IS NOT NULL
      AND a.format IN ('html','folder') AND ${TITLE_SLUG_SQL}=$3
      AND ($2::text IS NULL OR $2=ANY(a.ancestor_ids)) AND ${publicSiteAncestors('a',owner.kind)}
      AND ${siteTitlePathSql(owner.kind,'$2')}=$4 LIMIT 1`,
    [owner.id,owner.folderId??null,parts.at(-1),path])).rows[0] ?? null;
}
