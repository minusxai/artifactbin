import {createHash} from 'node:crypto';
import {artifactChannel, type HtmlBackendLink,type HtmlJson,type Queryable} from '@artifactbin/contracts';
import {getDb} from '../platform/db';
import {generateFileId} from '../platform/ids';
import type {PreparedHtmlBackend,HtmlBackendVersionRecord,HtmlBackendStoreValue,HtmlBackendStoreWrite} from './contracts';
export type {PreparedHtmlBackend,HtmlBackendVersionRecord} from './contracts';
/** The caller already holds the owning artifact's write lock. No effects escape its transaction. */
export async function commitHtmlBackends(tx:Queryable,pageId:string,ownerId:string,prepared:readonly PreparedHtmlBackend[],previous:readonly HtmlBackendLink[]):Promise<HtmlBackendLink[]>{
 const links:HtmlBackendLink[]=[];
 for(const backend of prepared){
  const prior=previous.find(link=>link.name===backend.name);
  // A removed name still recovers its own stable backend ID when explicitly reintroduced.
  const old=prior?.backendId??(await tx.query<{backend_id:string}>('SELECT backend_id FROM html_backend_versions WHERE page_id=$1 AND name=$2 LIMIT 1',[pageId,backend.name])).rows[0]?.backend_id;
  const backendId=old??generateFileId();
  const version=createHash('sha256').update(JSON.stringify([backend.source,backend.typeDefs,backend.compiled,backend.secretBindings??[]])).digest('hex');
  await tx.query(`INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING`,[backendId,version,pageId,backend.name,backend.source,backend.typeDefs,backend.compiled,ownerId,JSON.stringify(backend.secretBindings??[])]);
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
export async function setHtmlBackendStore(backendId:string,value:HtmlJson,expectedVersion:number):Promise<HtmlBackendStoreWrite>{
 const db=await getDb();
 const row=(await db.query<{version:number}>(`WITH updated AS (UPDATE html_backend_stores SET value=$2::jsonb,version=version+1 WHERE backend_id=$1 AND version=$3 RETURNING version), notified AS (SELECT pg_notify($4 || lower(v.page_id),updated.version::text) FROM updated JOIN (SELECT DISTINCT page_id FROM html_backend_versions WHERE backend_id=$1) v ON true) SELECT updated.version FROM updated CROSS JOIN (SELECT count(*) FROM notified) sent`,[backendId,JSON.stringify(value),expectedVersion,artifactChannel('')])).rows[0];
 if(row)return {ok:true,version:row.version};
 const current=await getHtmlBackendStore(backendId);return {ok:false,version:current.version};
}

export {htmlLiveLinks,htmlSharedRevisions,changedHtmlSharedRevisions} from './live';
