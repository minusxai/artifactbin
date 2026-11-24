/** The publishing host supplies this scope and revalidates its owner and selected root at release. */
import type { DatasetColumn } from '@artifactbin/contracts/sql';
import { siteTitlePathSql, publicSiteAncestors, type UserPagesOwner } from '@/lib/user-pages';
import { canonicalArtifactPath } from '@/lib/http';
import { getDb, PUBLIC_BASE_URL } from '@/lib/platform';
import { viewTotalsFor } from '@/lib/analytics';

export interface SiteFilesScope {
  owner: UserPagesOwner;
  folderId: string | null;
  origin: string;
  sitePath(row: { id: string; title: string | null; title_path: string|null; format: 'html' | 'folder' }): string;
}

const columns: DatasetColumn[] = ['id', 'parent_id', 'title', 'format', 'url', 'created_at', 'updated_at', 'views', 'likes']
  .map(name => ({ name, type: name === 'views' || name === 'likes' ? 'number' : 'string' }));

interface FileHeader {
  id: string;
  title_path: string|null;
  parent_id: string | null;
  title: string | null;
  format: string;
  created_at: Date | string;
  updated_at: Date | string;
  likes: number;
}

export function siteFiles(scope: SiteFilesScope) {
  function eligible(alias: string) {
    const owner = scope.owner.kind === 'group' ? `${alias}.group_id=$1` : `${alias}.user_id=$1 AND ${alias}.group_id IS NULL`;
    return `${owner} AND ${alias}.deleted_at IS NULL AND ${alias}.visibility='public'`;
  }

  // Check the entire placement, including folders above the selected root. Each folder must
  // report the matching prefix, so a stale descendant cannot bridge a moved folder.
  async function headers() {
    const db = await getDb();
    return (await db.query<FileHeader>(`
      SELECT ${siteTitlePathSql(scope.owner.kind,'$2')} AS title_path, a.id, a.title, a.format, a.created_at, a.updated_at,
        NULLIF(a.ancestor_ids[cardinality(a.ancestor_ids)], $2::text) AS parent_id,
        (SELECT count(*)::int FROM relations WHERE verb='like' AND object_kind='artifact'
          AND object_id=a.id AND status='accepted' AND deleted_at IS NULL) AS likes
      FROM artifacts a
      WHERE ${eligible('a')} AND ($2::text IS NULL OR $2=ANY(a.ancestor_ids))
        AND ${publicSiteAncestors('a',scope.owner.kind)}
      ORDER BY a.id`, [scope.owner.id, scope.folderId])).rows;
  }

  let admitted: string | undefined;
  return {
    columns,
    async load() {
      const rows = await headers();
      admitted = JSON.stringify(rows);
      const views = await viewTotalsFor(rows.map(row => row.id));
      return rows.map(({title_path,...row}) => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
        url: row.format === 'folder' || row.format === 'html'
          ? new URL(scope.sitePath({ title_path, id: row.id, title: row.title, format: row.format }), scope.origin).href
          : new URL(canonicalArtifactPath(row, scope.owner.handle), PUBLIC_BASE_URL).href,
        views: views.get(row.id) ?? 0,
      }));
    },
    async verify() {
      if (admitted !== undefined && JSON.stringify(await headers()) !== admitted) throw Error('page_unavailable');
    },
  };
}
