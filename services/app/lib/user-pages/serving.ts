import {type ArtifactRow,canReadArtifact,webAssetHashes} from '@/lib/artifacts';
import {artifactQuery} from '@/lib/artifacts/table';
import {LIVE_ARTIFACT_SQL} from '@/lib/artifact-access';
import {ANONYMOUS_ACTOR,ownerUsername} from '@/lib/accounts';
import {getDb,PUBLIC_BASE_URL,USER_PAGES_HOST} from '@/lib/platform';
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
const embeddedFormats=new Set(['image','file','pdf']);
export async function servesEmbeddedArtifact(owner:UserPagesOwner,row:ArtifactRow):Promise<boolean>{
 if(!embeddedFormats.has(row.format)||!await canReadArtifact(row,ANONYMOUS_ACTOR))return false;
 return (await (await getDb()).query(`SELECT 1 FROM artifacts WHERE ${ownerSql(owner)} AND visibility IN ('public','unlisted') AND format='html' AND ${LIVE_ARTIFACT_SQL} AND meta->'refs' @> $2::jsonb LIMIT 1`,[owner.id,JSON.stringify([{id:row.id}])])).rows.length>0;
}
/**
 * Whether the owner's host serves `/assets/<hash>`: one of its eligible pages names that image (meta.webAssets,
 * lib/artifacts web-assets). A hash no web_assets row has is refused by its primary key alone, before any page is
 * read. A known hash is the indexed `meta->'webAssets' ? hash`; only on a miss are pages written before the key
 * existed (none once scripts/backfill-web-assets.ts has run) matched by their source, exactly as they were.
 */
export async function servesWebAsset(owner:UserPagesOwner,hash:string):Promise<boolean>{
 const db=await getDb(),pages=`FROM artifacts WHERE ${ownerSql(owner)} AND visibility IN ('public','unlisted') AND format='html' AND ${LIVE_ARTIFACT_SQL}`;
 if(!(await db.query('SELECT 1 FROM web_assets WHERE url_hash=$1',[hash])).rows.length)return false;
 if((await db.query(`SELECT 1 ${pages} AND meta->'webAssets' ? $2 LIMIT 1`,[owner.id,hash])).rows.length)return true;
 const legacy=await artifactQuery<{source:string}>(db,`SELECT source ${pages} AND NOT (meta ? 'webAssets') AND source IS NOT NULL`,[owner.id]);
 return legacy.rows.some(post=>webAssetHashes(post.source).includes(hash));
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
