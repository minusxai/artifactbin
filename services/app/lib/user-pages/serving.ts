import {type ArtifactRow,canReadArtifact} from '@/lib/artifacts';
import {LIVE_ARTIFACT_SQL} from '@/lib/artifact-access';
import {ANONYMOUS_ACTOR,ownerUsername} from '@/lib/accounts';
import {getDb,PUBLIC_BASE_URL,TITLE_SLUG_SQL,USER_PAGES_HOST} from '@/lib/platform';
import {canonicalArtifactPath,domainPostPath} from '@/lib/http';
import {documentOwner,userPagesOrigin,type UserPagesOwner} from './hosts';
type ServedRow={user_id:string|null;group_id?:string|null;visibility:string;format:string;deleted_at?:unknown};
export const eligibleDocument=(row:ServedRow):boolean=>(row.visibility==='public'||row.visibility==='unlisted')&&row.format==='html'&&!row.deleted_at;
export function servesDocument(owner:UserPagesOwner,row:ServedRow):boolean {
 return eligibleDocument(row)&&(owner.kind==='group'?row.group_id===owner.id:!row.group_id&&row.user_id===owner.id);
}
const ownerSql=(owner:UserPagesOwner)=>owner.kind==='group'?'group_id = $1':'group_id IS NULL AND user_id = $1';
export async function publicHomeFiles(owner:UserPagesOwner){
 return (await (await getDb()).query<{id:string;format:string;title:string|null;version:number;updated_at:string}>(`SELECT id,format,title,version,updated_at FROM artifacts WHERE ${ownerSql(owner)} AND visibility='public' AND format='html' AND ${LIVE_ARTIFACT_SQL} ORDER BY updated_at DESC,id`,[owner.id])).rows;
}
/**
 * The page the host's root serves in place of the listing: the owner's EARLIEST live page titled "index" (any case;
 * by its title slug, as `/@handle/index` names it on the app, lib/artifacts/slug-address). The earliest decides, as it
 * does there: when it is not a public HTML page the root is the listing, never a later "index". One indexed probe
 * (lib/platform/schema idx_artifacts_user_slug / idx_artifacts_group_slug).
 */
export async function homePageId(owner:UserPagesOwner):Promise<string|null>{
 const scope=owner.kind==='group'?'group_id = $1 AND group_id IS NOT NULL':'user_id = $1 AND group_id IS NULL';
 const row=(await (await getDb()).query<{id:string;visibility:string;format:string}>(`SELECT id,visibility,format FROM artifacts WHERE ${scope} AND deleted_at IS NULL AND title IS NOT NULL AND ${TITLE_SLUG_SQL} = 'index' ORDER BY created_at,id LIMIT 1`,[owner.id])).rows[0];
 return row&&row.visibility==='public'&&row.format==='html'?row.id:null;
}
const embeddedFormats=new Set(['image','file','pdf']);
export async function servesEmbeddedArtifact(owner:UserPagesOwner,row:ArtifactRow):Promise<boolean>{
 if(!embeddedFormats.has(row.format)||!await canReadArtifact(row,ANONYMOUS_ACTOR))return false;
 return (await (await getDb()).query(`SELECT 1 FROM artifacts WHERE ${ownerSql(owner)} AND visibility IN ('public','unlisted') AND format='html' AND ${LIVE_ARTIFACT_SQL} AND meta->'refs' @> $2::jsonb LIMIT 1`,[owner.id,JSON.stringify([{id:row.id}])])).rows.length>0;
}
/**
 * Whether the owner's host serves `/assets/<hash>`: one of its eligible pages names that image (meta.webAssets,
 * lib/artifacts web-assets). A hash no web_assets row has is refused by its primary key alone, before any page is
 * read. A known hash is the indexed `meta->'webAssets' ? hash`; a page's source is never read here.
 */
export async function servesWebAsset(owner:UserPagesOwner,hash:string):Promise<boolean>{
 const db=await getDb(),pages=`FROM artifacts WHERE ${ownerSql(owner)} AND visibility IN ('public','unlisted') AND format='html' AND ${LIVE_ARTIFACT_SQL}`;
 if(!(await db.query('SELECT 1 FROM web_assets WHERE url_hash=$1',[hash])).rows.length)return false;
 return (await db.query(`SELECT 1 ${pages} AND meta->'webAssets' ? $2 LIMIT 1`,[owner.id,hash])).rows.length>0;
}
/** Bare hosts are copies: the app remains canonical, with no domain database lookup. */
export async function canonicalDocumentUrl(row:Pick<ArtifactRow,'id'|'title'|'user_id'> & {group_id?:string|null}):Promise<string>{
 return `${PUBLIC_BASE_URL.replace(/\/+$/,'')}${canonicalArtifactPath(row,row.group_id?(await documentOwner(row))?.handle??null:await ownerUsername(row.user_id))}`;
}
export function userPageUrlForOwner(row:Pick<ArtifactRow,'id'|'title'|'user_id'|'group_id'|'visibility'|'format'|'deleted_at'>,owner:UserPagesOwner|null):string|null {
 if(!owner||!servesDocument(owner,row))return null;
 const origin=userPagesOrigin(owner.handle);return origin?`${origin}${domainPostPath(row)}`:null;
}
export async function userPageUrl(row:ArtifactRow):Promise<string|null>{
 if(!USER_PAGES_HOST||!eligibleDocument(row))return null;
 return userPageUrlForOwner(row,await documentOwner(row));
}
