import {ownerHandleFromLabel, ownerSiteAddress} from '@artifactbin/contracts/owner-host';
import {isValidHandle} from '@artifactbin/contracts/handles';
import {getDb, PUBLIC_BASE_URL, USER_PAGES_HOST} from '@/lib/platform';
export interface UserPagesOwner {kind:'user'|'group';id:string;handle:string;folderId?:string|null}
export interface UserPagesSite {app:string;host:string|null}
export function userPagesLabel(handle:string|null|undefined):string|null{return typeof handle==='string'&&isValidHandle(handle)?handle.replaceAll('_','-'):null;}
export {ownerHandleFromLabel as handleFromLabel};
/** Includes apex and malformed/reserved child labels so boundaries can fail closed. */
export function isUserPagesHost(host:string,base:string|null=USER_PAGES_HOST):boolean {
 if(!base)return false;
 let named:string;try{named=new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/,'');}catch{return false;}
 return named===base||named.endsWith(`.${base}`);
}
export function handleFromUserPagesHost(host:string,base:string|null):string|null {
 const address=ownerSiteAddress(host,base);
 return address?.label===''?address.handle:null;
}
export function userPagesOrigin(handle:string,site:UserPagesSite={app:PUBLIC_BASE_URL,host:USER_PAGES_HOST}):string|null {
 const label=userPagesLabel(handle);if(!label||!site.host)return null;
 const app=new URL(site.app);return `${app.protocol}//${label}.${site.host}${app.port?`:${app.port}`:''}`;
}
/** Resolve current live identities, never historical reservations or creator attribution. */
export async function ownerForHandle(handle:string):Promise<UserPagesOwner|null>{
 if(!userPagesLabel(handle))return null;
 const db=await getDb();
 const rows=await db.query<UserPagesOwner>(`SELECT 'user' AS kind,id,username AS handle FROM users WHERE username=$1 AND kind='account' AND merged_into_user_id IS NULL
 UNION ALL SELECT 'group' AS kind,id,handle FROM groups WHERE handle=$1 AND deleted_at IS NULL`,[handle]);
 return rows.rows.length===1?rows.rows[0]!:null;
}
export async function documentOwner(row:{user_id:string|null;group_id?:string|null}):Promise<UserPagesOwner|null>{
 const db=await getDb();
 const owner=row.group_id
  ?(await db.query<{id:string;handle:string|null}>('SELECT id,handle FROM groups WHERE id=$1 AND deleted_at IS NULL',[row.group_id])).rows[0]
  :(await db.query<{id:string;handle:string|null}>('SELECT id,username AS handle FROM users WHERE id=$1 AND kind=\'account\' AND merged_into_user_id IS NULL',[row.user_id])).rows[0];
 return owner&&owner.handle&&userPagesLabel(owner.handle)?{kind:row.group_id?'group':'user',id:owner.id,handle:owner.handle}:null;
}
