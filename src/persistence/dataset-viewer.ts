import{createHash}from'node:crypto';
import type{SqlClient,SqlDatabase}from'./sql-contracts.ts';
import type{DatasetCallContext}from'../datasets/contracts.ts';
import type{DatasetViewerPorts,DatasetViewerSnapshot}from'../datasets/viewer-contracts.ts';
import{loadDocumentHeader}from'./document-records.ts';import{loadGroupAuthority}from'./group-memberships.ts';import{authorizePageRead}from'../server/document-authorization.ts';
/** The registry fixes the executing page/source namespace. No caller-selected subject or source. */
export async function loadDatasetViewer(client:SqlClient,context:DatasetCallContext,now:number):Promise<DatasetViewerSnapshot|null>{
 const groupAuthority=context.subject?await loadGroupAuthority(client,context.subject):undefined;
 const bindings=(await client.query(`SELECT b.source_namespace,b.page_version FROM dataset_viewer_bindings b
 JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL
 WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3
 AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version)`,[context.backendId,context.backendVersion,context.pageId])).rows;
 if(bindings.length!==1)return null;
 const binding=bindings[0]!;
 await client.query('SELECT id FROM files WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[context.pageId]);
 const page=await loadDocumentHeader(client,context.pageId);if(!page||page.head!==String(binding.page_version))return null;
 if(context.subject&&!(await client.query("SELECT actor FROM accounts WHERE actor=$1 AND principal_kind='user' FOR SHARE",[context.subject])).rows.length)return null;
 try{authorizePageRead({fileId:context.pageId,document:page,session:context.subject?{actor:context.subject,fileId:null,generation:null,expires:now+1,groupAuthority}:null,now});}catch{return null;}
 let id:string|null=null;
 if(context.subject){
  const mappings=(await client.query("SELECT legacy_id,identity,expires_at FROM dataset_principals WHERE source_namespace=$1 AND actor=$2 AND kind='user' ORDER BY legacy_id FOR SHARE",[binding.source_namespace,context.subject])).rows;
  if(mappings.length!==1)return null;
  const mapping=mappings[0]!;
  if(!['user','testuser'].includes(String(mapping.identity))||typeof mapping.legacy_id!=='string'||!mapping.legacy_id||mapping.legacy_id.length>256)return null;
  if(mapping.expires_at!=null){const expiry=mapping.expires_at instanceof Date?mapping.expires_at.getTime():typeof mapping.expires_at==='string'?Date.parse(mapping.expires_at):NaN;if(!Number.isFinite(expiry)||expiry<=now)return null;}
  id=mapping.legacy_id;
 }
 return{generation:createHash('sha256').update(JSON.stringify([context.backendId,context.backendVersion,page.id,page.head,page.generation,page.access,context.subject,id])).digest('hex'),id};
}
export function createDatasetViewerRepository(database:SqlDatabase,now=Date.now):DatasetViewerPorts{
 return{snapshot:(context,signal)=>database.transaction(client=>loadDatasetViewer(client,context,now()),{signal,timeoutMs:1000})};
}
