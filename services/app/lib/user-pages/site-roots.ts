/** Personal publishing mounts. Absence on the main host preserves its historical account-wide home. */
import {getDb, USER_PAGES_HOST} from '@/lib/platform';
import {handleFromLabel, userPagesLabel, ownerForHandle, type UserPagesOwner} from './hosts';

import {validSiteAlias} from '@artifactbin/contracts/site-alias';
const ownedFolder = "user_id=$1 AND group_id IS NULL AND format='folder' AND deleted_at IS NULL";

/** Every recorded ancestor must still be a public folder of this owner at its recorded position. */
export function publicSiteAncestors(row:string, kind:UserPagesOwner['kind']) {
  const owned = kind === 'group' ? 'p.group_id=$1' : 'p.user_id=$1 AND p.group_id IS NULL';
  return `NOT EXISTS (SELECT FROM unnest(${row}.ancestor_ids) WITH ORDINALITY path(id,depth)
    WHERE NOT EXISTS (SELECT FROM artifacts p WHERE p.id=path.id AND p.format='folder'
      AND p.deleted_at IS NULL AND p.visibility='public' AND ${owned}
      AND p.ancestor_ids=${row}.ancestor_ids[1:path.depth::int-1]))`;
}

export async function hasPublicSiteAncestors(owner:UserPagesOwner,row:{id:string;ancestor_ids?:string[]|null}) {
  if (!row.ancestor_ids?.length) return true;
  return !!(await (await getDb()).query(`SELECT 1 FROM artifacts a WHERE id=$2 AND ${publicSiteAncestors('a',owner.kind)}`,[owner.id,row.id])).rows.length;
}

export async function websiteSettings(userId: string) {
  const db = await getDb();
  const [roots, folders] = await Promise.all([
    db.query<{subdomain_label:string;folder_id:string|null}>('SELECT subdomain_label,folder_id FROM user_site_roots WHERE user_id=$1 ORDER BY subdomain_label',[userId]),
    db.query(`SELECT id,title,ancestor_ids FROM artifacts WHERE ${ownedFolder} ORDER BY title,id`,[userId]),
  ]);
  return {roots:roots.rows, folders:folders.rows};
}

export async function saveSiteRoot(userId:string, label:string, folderId:string|null, expectedFolderId?:string|null) {
  const db = await getDb();
  return db.transaction(async tx => {
    if (label) {
      const account = (await tx.query<{username:string|null}>('SELECT username FROM users WHERE id=$1',[userId])).rows[0];
      const owner = userPagesLabel(account?.username);
      if (!owner || !validSiteAlias(label, USER_PAGES_HOST ? owner+'.'+USER_PAGES_HOST : owner)) return 'invalid_subdomain_label';
    }
    if (folderId !== null && !(await tx.query(`SELECT id FROM artifacts WHERE ${ownedFolder} AND id=$2 FOR SHARE`,[userId,folderId])).rows.length) return 'folder_not_found';
    const result = expectedFolderId === undefined
      ? await tx.query('INSERT INTO user_site_roots(user_id,subdomain_label,folder_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',[userId,label,folderId])
      : await tx.query('UPDATE user_site_roots SET folder_id=$3 WHERE user_id=$1 AND subdomain_label=$2 AND folder_id IS NOT DISTINCT FROM $4::text RETURNING user_id',[userId,label,folderId,expectedFolderId]);
    return result.rows.length ? 'saved' : 'site_conflict';
  });
}

export async function deleteSiteRoot(userId:string,label:string,expectedFolderId?:string|null) {
  const result = await (await getDb()).query(`DELETE FROM user_site_roots
    WHERE user_id=$1 AND subdomain_label=$2 AND subdomain_label<>''
      AND ($3::boolean OR folder_id IS NOT DISTINCT FROM $4::text) RETURNING user_id`,
    [userId,label,expectedFolderId===undefined,expectedFolderId??null]);
  return expectedFolderId===undefined || result.rows.length>0;
}

export function siteAddress(host:string, base=USER_PAGES_HOST) {
  if (!base) return null;
  const hostname = host.toLowerCase().replace(/:\d+$/,'').replace(/\.$/,'');
  const suffix = '.' + base.toLowerCase().replace(/\.$/,'');
  if (hostname.length > 253 || !hostname.endsWith(suffix)) return null;
  const child = hostname.slice(0,-suffix.length);
  const split = child.indexOf('--');
  const owner = split < 0 ? child : child.slice(0,split);
  const handle = handleFromLabel(owner);
  const label = split < 0 ? '' : child.slice(split+2);
  return handle && (split < 0 || validSiteAlias(label,owner+suffix)) ? {handle,label} : null;
}

export async function siteOwner(address:{handle:string;label:string}):Promise<UserPagesOwner|null> {
  const owner = await ownerForHandle(address.handle);
  if (!owner || owner.kind==='group') return address.label ? null : owner;
  const mapping = (await (await getDb()).query<{folder_id:string|null;live:boolean}>(`SELECT folder_id,
    folder_id IS NULL OR EXISTS(SELECT 1 FROM artifacts a WHERE ${ownedFolder} AND id=folder_id AND visibility='public' AND ${publicSiteAncestors('a',owner.kind)}) AS live
    FROM user_site_roots WHERE user_id=$1 AND subdomain_label=$2`,[owner.id,address.label])).rows[0];
  if (!mapping) return address.label ? null : owner;
  return mapping.live ? {...owner,folderId:mapping.folder_id} : null;
}

/** Placement and live ownership only. Consumers also apply the operation's own anonymous ACL. */
export function inSiteScope(owner:UserPagesOwner,row:{deleted_at?:unknown;user_id:string|null;group_id?:string|null;ancestor_ids?:string[]|null}):boolean {
  if (row.deleted_at) return false;
  if (owner.kind==='group') return row.group_id===owner.id;
  return !row.group_id && row.user_id===owner.id && (!owner.folderId || !!row.ancestor_ids?.includes(owner.folderId));
}
