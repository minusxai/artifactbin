import {createHash} from 'node:crypto';
import {artifactChannel, type HtmlBackendLink,type HtmlJson,type Queryable} from '@artifactbin/contracts';
import {mayPublishBackendChange,requiresFreshBackendIdentity} from './authority';
import {getDb} from '../platform/db';
import {generateFileId} from '../platform/ids';
import type {PreparedHtmlBackend,HtmlBackendVersionRecord,HtmlBackendStoreValue,HtmlBackendStoreWrite,HtmlBackendWriteScope} from './contracts';
export type {PreparedHtmlBackend,HtmlBackendVersionRecord} from './contracts';
/** Called under the owning page lock before writing any immutable version. */
export async function mayCommitHtmlBackends(tx:Queryable,pageId:string,personalOwner:boolean,prepared:readonly PreparedHtmlBackend[]):Promise<boolean>{
 for(const backend of prepared){
  const history=(await tx.query<{protected:boolean}>(`SELECT EXISTS(SELECT 1 FROM html_backend_versions v WHERE v.page_id=$1 AND v.name=$2 AND (jsonb_array_length(v.secret_bindings)>0 OR EXISTS(SELECT 1 FROM html_backend_secrets s WHERE s.backend_id=v.backend_id))) AS protected`,[pageId,backend.name])).rows[0]?.protected??false;
  if(!mayPublishBackendChange({personalOwner,declaresSecrets:!!backend.secretBindings?.length,historicalSecrets:history}))return false;
 }
 return true;
}
/** The caller already holds the owning artifact's write lock. No effects escape its transaction. */
export async function commitHtmlBackends(tx:Queryable,pageId:string,ownerId:string,prepared:readonly PreparedHtmlBackend[],previous:readonly HtmlBackendLink[]):Promise<HtmlBackendLink[]>{
 const links:HtmlBackendLink[]=[];
 for(const backend of prepared){
  const prior=previous.find(link=>link.name===backend.name);
  // A removed name still recovers its own stable backend ID when explicitly reintroduced.
  const old=prior?.backendId??(await tx.query<{backend_id:string}>(`SELECT link->>'backendId' AS backend_id FROM artifact_versions v CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.meta->'htmlLinks','[]'::jsonb)) link WHERE v.artifact_id=$1 AND link->>'kind'='backend' AND link->>'name'=$2 ORDER BY v.version DESC LIMIT 1`,[pageId,backend.name])).rows[0]?.backend_id;
  const previousOwner=old?(await tx.query<{owner_id:string}>('SELECT owner_id FROM html_backend_versions WHERE backend_id=$1 LIMIT 1',[old])).rows[0]?.owner_id:undefined;
  const fresh=previousOwner!==undefined&&requiresFreshBackendIdentity({previousOwnerId:previousOwner,nextOwnerId:ownerId});
  const backendId=!old||fresh?generateFileId():old;
  const version=createHash('sha256').update(JSON.stringify([backend.source,backend.typeDefs,backend.compiled,backend.secretBindings??[]])).digest('hex');
  await tx.query(`INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING`,[backendId,version,pageId,backend.name,backend.source,backend.typeDefs,backend.compiled,ownerId,JSON.stringify(backend.secretBindings??[])]);
  if(fresh)await tx.query('INSERT INTO html_backend_stores(backend_id,value,version) SELECT $1,value,version FROM html_backend_stores WHERE backend_id=$2 ON CONFLICT DO NOTHING',[backendId,old]);
  await tx.query('INSERT INTO html_backend_stores(backend_id,value,version) VALUES($1,NULL,0) ON CONFLICT DO NOTHING',[backendId]);
  links.push({kind:'backend',name:backend.name,backendId,version});
 }
 return links;
}
/** Internal execution adapter: access is established by the resolved immutable page link. */
export async function getHtmlBackendVersion(backendId:string,version:string):Promise<HtmlBackendVersionRecord|null>{
 const row=(await (await getDb()).query<{backend_id:string;page_id:string;name:string;version:string;source:string;type_defs:string;compiled:string;owner_id:string;secret_bindings:string[]}>('SELECT * FROM html_backend_versions WHERE backend_id=$1 AND version=$2',[backendId,version])).rows[0];
 return row?{backendId:row.backend_id,pageId:row.page_id,name:row.name,version:row.version,source:row.source,typeDefs:row.type_defs,compiled:row.compiled,ownerId:row.owner_id,secretBindings:row.secret_bindings??[]}:null;
}
export async function getHtmlBackendStore(backendId:string):Promise<HtmlBackendStoreValue>{
 const row=(await (await getDb()).query<{value:HtmlJson|null;version:number}>('SELECT value,version FROM html_backend_stores WHERE backend_id=$1',[backendId])).rows[0];
 if(!row)throw new Error('Backend not found');return row;
}
export async function setHtmlBackendStore(backendId:string,value:HtmlJson,expectedVersion:number,scope?:HtmlBackendWriteScope):Promise<HtmlBackendStoreWrite>{
 const db=await getDb();
 return db.transaction(async tx=>{
 if(scope){
  // Publication locks the page before touching its backend stores. Keep that order here.
  const page=(await tx.query<{user_id:string|null;meta:{htmlLinks?:HtmlBackendLink[]}}>('SELECT user_id,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[scope.pageId])).rows[0];
  if(!page||page.user_id&&page.user_id!==scope.ownerId||!page.meta.htmlLinks?.some(link=>link.kind==='backend'&&link.backendId===backendId&&link.version===scope.version))throw Error('backend_binding_changed');
 }
 const row=(await tx.query<{version:number}>(`WITH updated AS (UPDATE html_backend_stores SET value=$2::jsonb,version=version+1 WHERE backend_id=$1 AND version=$3 RETURNING version), notified AS (SELECT pg_notify($4 || lower(v.page_id),updated.version::text) FROM updated JOIN (SELECT DISTINCT page_id FROM html_backend_versions WHERE backend_id=$1) v ON true) SELECT updated.version FROM updated CROSS JOIN (SELECT count(*) FROM notified) sent`,[backendId,JSON.stringify(value),expectedVersion,artifactChannel('')])).rows[0];
 if(row)return {ok:true,version:row.version};
 const current=(await tx.query<{version:number}>('SELECT version FROM html_backend_stores WHERE backend_id=$1',[backendId])).rows[0];if(!current)throw Error('Backend not found');return {ok:false,version:current.version};
 });
}

export {htmlLiveLinks,htmlSharedRevisions,changedHtmlSharedRevisions} from './live';
