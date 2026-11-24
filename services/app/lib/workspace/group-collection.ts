/**
 * Group-scoped folder browsing. Reach starts at this group's ancestor-owned/shared rows,
 * then follows the existing folder shelf rule, never ambient personal ownership or links.
 * SQL scans bounded keyset batches; ACL exclusions never consume a page or impose a feed cap.
 * Cursors authenticate the actor, group, container, page size and last emitted ordering key.
 * Every request rechecks live membership, reach and folder admission (no authority in a cursor).
 */
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {ArtifactRow} from '@/lib/artifacts';
import {listedFolderChild,parentOf} from '@/lib/artifacts';
import {canAnnotate} from '@artifactbin/contracts/sharing';
import type { GroupCollection, GroupCollectionItem } from '@artifactbin/contracts/groups';
import {principalKey,type AccessActor} from '@/lib/accounts';
import {LIVE_ARTIFACT_SQL,effectiveRole,roleWithoutLink} from '@/lib/artifact-access';
import {GroupError,actorGroupRole,groupChain} from '@/lib/groups';
import {AUTH_SECRET,getDb} from '@/lib/platform';

interface GroupCollectionInput {parent_id?:string;limit?:number;cursor?:string;}

type Row=Pick<ArtifactRow,'id'|'title'|'format'|'user_id'|'group_id'|'token_id'|'visibility'|'link_role'|'ancestor_ids'> & {updated_at:string;sort_time:string;rank:number;seed:boolean};
type Key={rank:number;time:string;id:string};
const fields=`a.id,a.title,a.format,a.user_id,a.group_id,a.token_id,a.visibility,a.link_role,a.ancestor_ids,
 a.updated_at,a.updated_at::text AS sort_time,CASE WHEN a.format='folder' THEN 0 ELSE 1 END AS rank,
 (a.group_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM artifact_group_shares s WHERE s.artifact_id=a.id AND s.group_id=ANY($1::text[]))) AS seed`;
const sign=(payload:string)=>createHmac('sha256',AUTH_SECRET).update('group-collection\0'+payload).digest('base64url');
const invalid=()=>new GroupError('invalid_cursor',400);

export async function groupCollectionFor(actor:AccessActor,groupId:string,input:GroupCollectionInput={}):Promise<GroupCollection>{
 const db=await getDb();
 if(!await actorGroupRole(actor,groupId,db))throw new GroupError('not_found',404);
 const chain=await groupChain(db,groupId);
 if(!chain.length)throw new GroupError('not_found',404);
 const limit=input.limit??50,parent=input.parent_id??null;
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new GroupError('invalid_group',400);
 const scope=JSON.stringify([actor.principalGroup?principalKey(actor.principalGroup):actor.userId,groupId,parent,limit]);
 let after:Key|null=null;
 if(input.cursor){
  try{
   const [payload,mac,...extra]=input.cursor.split('.');
   if(extra.length||!payload||!mac||mac.length!==43||!timingSafeEqual(Buffer.from(mac),Buffer.from(sign(payload))))throw invalid();
   const value=JSON.parse(Buffer.from(payload,'base64url').toString());
   if(value.scope!==scope||![0,1].includes(value.key?.rank)||typeof value.key?.time!=='string'||!Number.isFinite(Date.parse(value.key.time))||typeof value.key?.id!=='string')throw invalid();
   after=value.key;
  }catch{throw invalid();}
 }
 const cache=new Map<string,Promise<Row|null>>();
 const load=(id:string):Promise<Row|null>=>{
  let found=cache.get(id);
  if(!found){found=db.query<Row>(`SELECT ${fields} FROM artifacts a WHERE a.id=$2 AND a.${LIVE_ARTIFACT_SQL}`,[chain,id]).then(r=>r.rows[0]??null);cache.set(id,found);}
  return found;
 };
 // Placement depth is bounded by the existing six-level invariant. A defensive cycle fence
 // also refuses malformed historical placement without revealing it.
 const reached=async(row:Row,seen=new Set<string>()):Promise<boolean>=>{
  if(seen.has(row.id)||seen.size>6)return false;
  if(row.seed&&await roleWithoutLink(row,actor)!=='none')return true;
  if(actor.principalGroup&&await effectiveRole(row,actor)==='none')return false;
  seen.add(row.id);
  const p=parentOf(row),folder=p?await load(p):null;
  return !!folder&&folder.format==='folder'&&await reached(folder,seen)&&await listedFolderChild(row,actor,canAnnotate(await effectiveRole(folder,actor)));
 };
 const visibleParent=async(row:Row)=>{
  const p=parentOf(row),folder=p?await load(p):null;
  return folder?.format==='folder'&&await reached(folder)?p:null;
 };
 if(parent){const folder=await load(parent);if(!folder||folder.format!=='folder'||!await reached(folder))throw new GroupError('not_found',404);}
 const picked:Row[]=[];
 while(picked.length<=limit){
  cache.clear();
  const batch=(await db.query<Row>(`SELECT ${fields} FROM artifacts a WHERE a.${LIVE_ARTIFACT_SQL}
   AND (a.group_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM artifact_group_shares s WHERE s.artifact_id=a.id AND s.group_id=ANY($1::text[]))
    OR a.ancestor_ids && ARRAY(SELECT f.id FROM artifacts f WHERE f.format='folder' AND f.${LIVE_ARTIFACT_SQL}
     AND (f.group_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM artifact_group_shares s WHERE s.artifact_id=f.id AND s.group_id=ANY($1::text[])))))
   AND ($2::text IS NULL OR a.ancestor_ids[cardinality(a.ancestor_ids)]=$2)
   AND ($3::int IS NULL OR (CASE WHEN a.format='folder' THEN 0 ELSE 1 END)>$3
    OR ((CASE WHEN a.format='folder' THEN 0 ELSE 1 END)=$3 AND (a.updated_at<$4::timestamptz OR (a.updated_at=$4::timestamptz AND a.id COLLATE "C">$5))))
   ORDER BY rank,a.updated_at DESC,a.id COLLATE "C" LIMIT 100`,[chain,parent,after?.rank??null,after?.time??null,after?.id??null])).rows;
  if(!batch.length)break;
  for(const row of batch){
   after={rank:row.rank,time:row.sort_time,id:row.id};
   if(!await reached(row)||await visibleParent(row)!==parent)continue;
   picked.push(row);if(picked.length>limit)break;
  }
  if(picked.length>limit||batch.length<100)break;
 }
 const more=picked.length>limit;const rows=picked.slice(0,limit);
 const users=rows.flatMap(r=>!r.group_id&&r.user_id?[r.user_id]:[]),groups=rows.flatMap(r=>r.group_id?[r.group_id]:[]);
 const names=await db.query<{id:string;name:string}>(`SELECT id,COALESCE(name,username,'Someone') AS name FROM users WHERE id=ANY($1::text[])`,[users]);
 const groupNames=await db.query<{id:string;name:string}>('SELECT id,name FROM groups WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[groups]);
 const people=new Map(names.rows.map(r=>[r.id,r.name])),teams=new Map(groupNames.rows.map(r=>[r.id,r.name]));
 const items:GroupCollectionItem[]=rows.map(r=>({id:r.id,title:r.title||'Untitled',format:r.format,updated_at:new Date(r.updated_at).toISOString(),parent_id:parent,
  owner:r.group_id?{kind:'group',name:teams.get(r.group_id)??'A group'}:{kind:'user',name:people.get(r.user_id??'')??'Someone'}}));
 let next_cursor:string|null=null;
 if(more){const last=rows[rows.length-1],payload=Buffer.from(JSON.stringify({scope,key:{rank:last.rank,time:last.sort_time,id:last.id}})).toString('base64url');next_cursor=payload+'.'+sign(payload);}
 return {items,next_cursor};
}
