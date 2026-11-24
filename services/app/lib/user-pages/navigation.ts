import { getDb } from '@/lib/platform';
import { publicSiteAncestors } from './site-roots';
import { homePageId } from './serving';
import { siteTitleTarget } from './title-path';
import type { UserPagesOwner } from './hosts';

type Destination =
  | { kind: 'page'; id: string; unlisted: boolean }
  | { kind: 'listing'; folderId?: string | null; unlisted: boolean };

/** The directory policy is shared by root, readable paths and stable folder links.
 * Only legacy hosts can generate a directory listing when there is no direct index. */
export async function siteDestination(owner: UserPagesOwner, path: string): Promise<Destination | null> {
  let folderId = owner.folderId;
  let unlisted = false;
  if (path !== '/') {
    const stable = /^\/folders\/([A-Za-z0-9]+)\/?$/.exec(path);
    if (stable) {
      const ownership = owner.kind === 'group' ? 'group_id=$1' : 'user_id=$1 AND group_id IS NULL';
      const folder = (await (await getDb()).query<{visibility:string}>(`SELECT visibility FROM artifacts a
        WHERE id=$2 AND ${ownership} AND format='folder' AND deleted_at IS NULL AND visibility IN ('public','unlisted')
          AND ($3::text IS NULL OR $3=ANY(ancestor_ids)) AND ${publicSiteAncestors('a',owner.kind)}`,
        [owner.id,stable[1],owner.folderId??null])).rows[0];
      if (!folder) return null;
      folderId = stable[1]!;
      unlisted = folder.visibility === 'unlisted';
    } else {
      const target = await siteTitleTarget(owner,path.replace(/\/$/,''));
      if (!target) return null;
      if (target.format === 'html') return path.endsWith('/') ? null : { kind:'page', id:target.id, unlisted:false };
      folderId = target.id;
    }
  }
  const index = await homePageId(owner,folderId);
  if (index) return { kind:'page', id:index, unlisted };
  return owner.folderId === undefined ? { kind:'listing', folderId, unlisted } : null;
}
