import {createHash} from 'node:crypto';
import type {HtmlBackendLink,Queryable} from '@artifactbin/contracts';
import {mayPublishBackendChange,requiresFreshBackendIdentity} from './authority';
import { getDb, generateFileId } from '../platform';
import type {PreparedHtmlBackend,HtmlBackendVersionRecord} from './contracts';
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
  const secretHosts=backend.secretHosts??{};
  const version=createHash('sha256').update(JSON.stringify([backend.source,backend.typeDefs,backend.compiled,backend.secretBindings??[],secretHosts])).digest('hex');
  await tx.query(`INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings,secret_hosts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT DO NOTHING`,[backendId,version,pageId,backend.name,backend.source,backend.typeDefs,backend.compiled,ownerId,JSON.stringify(backend.secretBindings??[]),JSON.stringify(secretHosts)]);
  links.push({kind:'backend',name:backend.name,backendId,version});
 }
 return links;
}
/** Internal execution adapter: access is established by the resolved immutable page link. */
export async function getHtmlBackendVersion(backendId:string,version:string):Promise<HtmlBackendVersionRecord|null>{
 const row=(await (await getDb()).query<{backend_id:string;page_id:string;name:string;version:string;source:string;type_defs:string;compiled:string;owner_id:string;secret_bindings:string[];secret_hosts:Record<string,string>|null}>('SELECT * FROM html_backend_versions WHERE backend_id=$1 AND version=$2',[backendId,version])).rows[0];
 return row?{backendId:row.backend_id,pageId:row.page_id,name:row.name,version:row.version,source:row.source,typeDefs:row.type_defs,compiled:row.compiled,ownerId:row.owner_id,secretBindings:row.secret_bindings??[],secretHosts:row.secret_hosts??{}}:null;
}

export {htmlLiveLinks,htmlSharedRevisions,changedHtmlSharedRevisions} from './live';
