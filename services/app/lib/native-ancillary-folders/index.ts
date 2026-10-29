import {isDeepStrictEqual} from 'node:util';
import type {Queryable} from '@artifactbin/contracts';
import type {NativeIdentityPlan} from '@/lib/native-identity-import';
import type {NativeAncillaryFolderRecipe,NativePreparedAncillaryFolders} from './contracts';
import {verifyAncillaryRecipe} from './projection';
export type {NativeAncillaryFolderRecipe,NativePreparedAncillaryFolders} from './contracts';
const jsonFields=new Set(['meta','dataset_policy','document']);
const dateFields=new Set(['created_at','updated_at','deleted_at','document_archived_at']);
const collision=()=>Error('native_ancillary_collision');
/** Offline operator-only stage. It neither opens a database nor manufactures principals.
 * Caller composes apply/verify after identity import inside the same prerequisite transaction. */
export function prepareNativeAncillaryFolders(raw:NativeAncillaryFolderRecipe,identityPlan:NativeIdentityPlan,identityGroups:Readonly<Record<string,string>>={}):NativePreparedAncillaryFolders {
 const recipe=verifyAncillaryRecipe(raw,identityPlan,identityGroups),folders=[...recipe.folders].sort((a,b)=>(a.row.ancestor_ids as string[]).length-(b.row.ancestor_ids as string[]).length||a.targetId.localeCompare(b.targetId));
 for(const folder of folders){
  const row=folder.row;
  if(!/^[A-Za-z0-9]{6,128}$/.test(folder.targetId)||row.id!==folder.targetId||row.format!=='folder'||(!row.user_id&&!row.group_id&&!row.token_id)||row.user_id&&row.group_id||!['public','unlisted','private'].includes(String(row.visibility))||!['viewer','commenter','editor',null].includes(row.link_role as string|null)||!['read','readwrite'].includes(String(row.access))||!Number.isSafeInteger(row.version)||Number(row.version)<1||typeof row.edit_id!=='string'||!row.edit_id||!Array.isArray(row.ancestor_ids)||(row.ancestor_ids as unknown[]).length>=6)throw Error('native_ancillary_folder_shape');
  for(const key of dateFields)if(row[key]!==null&&(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key] as string))))throw Error('native_ancillary_timestamp');
 }
 const principals=async(tx:Queryable,folder:typeof folders[number])=>{
  const row=folder.row,users=[...new Set([row.user_id,row.creator_user_id,row.actor_user_id,...folder.shares.map(share=>share.userId)].filter((id):id is string=>typeof id==='string'))],tokens=[...new Set([row.token_id,row.actor_token_id].filter((id):id is string=>typeof id==='string'))];
  if((await tx.query('SELECT id FROM users WHERE id=ANY($1::text[]) FOR SHARE',[users])).rows.length!==users.length||(await tx.query('SELECT id FROM tokens WHERE id=ANY($1::text[]) FOR SHARE',[tokens])).rows.length!==tokens.length||row.group_id&&!(await tx.query('SELECT id FROM groups WHERE id=$1 FOR SHARE',[row.group_id])).rows.length)throw Error('native_ancillary_principal');
  const ancestors=row.ancestor_ids as string[];
  if(ancestors.length){const rows=(await tx.query<Record<string,unknown>>('SELECT id,format,user_id,group_id,token_id,ancestor_ids,deleted_at FROM artifacts WHERE id=ANY($1::text[]) FOR SHARE',[ancestors])).rows;
   if(rows.length!==ancestors.length||ancestors.some((id,index)=>{const parent=rows.find(value=>value.id===id);return !parent||parent.format!=='folder'||parent.deleted_at!==null||parent.user_id!==row.user_id||parent.group_id!==row.group_id||!row.user_id&&!row.group_id&&parent.token_id!==row.token_id||!isDeepStrictEqual(parent.ancestor_ids,ancestors.slice(0,index));}))throw Error('native_ancillary_placement');
  }
 };
 const verifyOne=async(tx:Queryable,folder:typeof folders[number])=>{
  const expected=folder.row,owner=expected.creator_user_id??expected.user_id??expected.token_id??expected.group_id;
  const reservation=(await tx.query<{owner:string;consumed:boolean}>('SELECT owner,consumed FROM artifact_id_registry WHERE id=$1 FOR SHARE',[folder.targetId])).rows[0];
  if(!reservation||reservation.owner!==owner||reservation.consumed!==true)throw collision();
  const keys=Object.keys(expected),dates=keys.filter(key=>dateFields.has(key)),scalars=keys.filter(key=>!dateFields.has(key));
  const result=(await tx.query<Record<string,unknown>>(`SELECT forked_from IS NULL AS ancillary_only,${scalars.map(key=>`"${key}"`).join(',')},${dates.map((key,index)=>`"${key}" IS NOT DISTINCT FROM $${index+2}::timestamptz AS "matches_${key}"`).join(',')} FROM artifacts WHERE id=$1 FOR SHARE`,[folder.targetId,...dates.map(key=>expected[key])])).rows[0];
  if(!result||result.ancillary_only!==true||scalars.some(key=>!isDeepStrictEqual(result[key],expected[key]))||dates.some(key=>result['matches_'+key]!==true))throw collision();
  const actual=(await tx.query<{email:string;role:string;user_id:string|null;created_at:Date}>('SELECT email,role,user_id,created_at FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[folder.targetId])).rows;
  if(actual.length!==folder.shares.length||folder.shares.some((share,index)=>{const stored=actual[index]!;return stored.email!==share.email||stored.role!==share.role||Object.hasOwn(share,'userId')&&stored.user_id!==share.userId;}))throw collision();
  for(const share of folder.shares)if(share.createdAt!==undefined&&!(await tx.query('SELECT 1 FROM artifact_shares WHERE artifact_id=$1 AND email=$2 AND created_at=$3::timestamptz',[folder.targetId,share.email,share.createdAt])).rows.length)throw collision();
 };
 const verify=async(tx:Queryable)=>{for(const folder of folders){await principals(tx,folder);await verifyOne(tx,folder);}};
 return Object.freeze({sourceSha256:recipe.sha256,verify,async apply(tx:Queryable){
  const created:string[]=[],unchanged:string[]=[];
  for(const folder of folders){
   await tx.query("SELECT pg_advisory_xact_lock(hashtext('native-ancillary-folder:' || $1))",[folder.targetId]);
   const exists=(await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE',[folder.targetId])).rows.length;
   await principals(tx,folder);
   if(exists){await verifyOne(tx,folder);unchanged.push(folder.targetId);continue;}
   const row=folder.row,owner=row.creator_user_id??row.user_id??row.token_id??row.group_id;
   if(!(await tx.query('INSERT INTO artifact_id_registry(id,owner,consumed) VALUES($1,$2,true) ON CONFLICT DO NOTHING RETURNING id',[folder.targetId,owner])).rows.length)throw collision();
   const keys=Object.keys(row),params=keys.map(key=>jsonFields.has(key)&&row[key]!==null?JSON.stringify(row[key]):row[key]);
   await tx.query(`INSERT INTO artifacts(${keys.map(key=>`"${key}"`).join(',')}) VALUES(${keys.map((key,index)=>`$${index+1}${jsonFields.has(key)?'::jsonb':''}`).join(',')})`,params);
   for(const share of folder.shares){const keys=['artifact_id','email','role',...(Object.hasOwn(share,'userId')?['user_id']:[]),...(share.createdAt!==undefined?['created_at']:[])],values=[folder.targetId,share.email,share.role,...(Object.hasOwn(share,'userId')?[share.userId]:[]),...(share.createdAt!==undefined?[share.createdAt]:[])];await tx.query(`INSERT INTO artifact_shares(${keys.join(',')}) VALUES(${keys.map((_,index)=>`$${index+1}`).join(',')})`,values);}
   await verifyOne(tx,folder);created.push(folder.targetId);
  }
  return {created,unchanged};
 }});
}
