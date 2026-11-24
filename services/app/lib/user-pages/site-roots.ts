/** Personal publishing mounts. Absence on the main host preserves its historical account-wide home. */
import {getDb, USER_PAGES_HOST} from '@/lib/platform';
import {handleFromUserPagesHost, ownerForHandle, type UserPagesOwner} from './hosts';

export const validSiteLabel = (label: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
const ownedFolder = "user_id=$1 AND group_id IS NULL AND format='folder' AND deleted_at IS NULL";

export async function websiteSettings(userId: string) {
  const db = await getDb();
  const [roots, folders] = await Promise.all([
    db.query<{subdomain_label:string;folder_id:string|null}>('SELECT subdomain_label,folder_id FROM user_site_roots WHERE user_id=$1 ORDER BY subdomain_label',[userId]),
    db.query(`SELECT id,title,ancestor_ids FROM artifacts WHERE ${ownedFolder} ORDER BY title,id`,[userId]),
  ]);
  return {roots:roots.rows, folders:folders.rows};
}

export async function saveSiteRoot(userId:string, label:string, folderId:string|null) {
  const db = await getDb();
  return db.transaction(async tx => {
    if (folderId !== null && !(await tx.query(`SELECT id FROM artifacts WHERE ${ownedFolder} AND id=$2 FOR SHARE`,[userId,folderId])).rows.length) return false;
    await tx.query('INSERT INTO user_site_roots(user_id,subdomain_label,folder_id) VALUES ($1,$2,$3) ON CONFLICT (user_id,subdomain_label) DO UPDATE SET folder_id=EXCLUDED.folder_id',[userId,label,folderId]);
    return true;
  });
}

export async function deleteSiteRoot(userId:string,label:string) {
  await (await getDb()).query("DELETE FROM user_site_roots WHERE user_id=$1 AND subdomain_label=$2 AND subdomain_label<>''",[userId,label]);
}

export function siteAddress(host:string, base=USER_PAGES_HOST) {
  const main = handleFromUserPagesHost(host,base);
  if (main) return {handle:main,label:''};
  const dot = host.indexOf('.');
  const label = host.slice(0,dot);
  const handle = dot > 0 && validSiteLabel(label) && handleFromUserPagesHost(host.slice(dot+1),base);
  return handle ? {handle,label} : null;
}

export async function siteOwner(address:{handle:string;label:string}):Promise<UserPagesOwner|null> {
  const owner = await ownerForHandle(address.handle);
  if (!owner || owner.kind==='group') return address.label ? null : owner;
  const mapping = (await (await getDb()).query<{folder_id:string|null;live:boolean}>(`SELECT folder_id,
    folder_id IS NULL OR EXISTS(SELECT 1 FROM artifacts WHERE ${ownedFolder} AND id=folder_id) AS live
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
