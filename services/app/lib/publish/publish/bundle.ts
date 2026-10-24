import {createHash} from 'node:crypto';
import type {TokenHoldingActor} from '@/lib/accounts';
import {getOwnedArtifactFor,reserveIds} from '@/lib/artifacts';
import {json} from '@/lib/http';
import {planPublicationBundle,publishBundleDependencies,type PublicationBundle} from '@/lib/html-publication-bundle';
export async function preparePublicationBundle(body:Record<string,unknown>,actor:TokenHoldingActor,base:string,request:Request|undefined,create:(body:Record<string,unknown>,request:Request)=>Promise<Response>,update:(id:string,body:Record<string,unknown>,key:string)=>Promise<Response>,existingPageId?:string):Promise<{body:Record<string,unknown>;receipts:unknown[]}|Response>{
 if(typeof body.html!=='string')return body.publicationBundle===undefined?{body,receipts:[]}:json({error:'invalid_publication_bundle'},400);
 let plan;const bundle=body.publicationBundle as PublicationBundle|undefined;
 try{plan=planPublicationBundle(body.html,bundle??{entryPath:'index.html',files:[]});}catch(error){return json({error:'unresolved_publication_dependencies',details:[(error as Error).message]},400);}
 if(Object.keys(plan.backendSources).length){
  const explicit=body.backendSources as Record<string,unknown>|undefined;
  if(explicit&&Object.entries(plan.backendSources).some(([name,source])=>explicit[name]!==undefined&&explicit[name]!==source))return json({error:'conflicting_backend_sources'},400);
  body={...body,backendSources:{...explicit,...plan.backendSources}};
 }
 if(!bundle)return {body,receipts:[]};
 const key=request?.headers.get('Idempotency-Key');if(!key||!/^[-_A-Za-z0-9]{16,128}$/.test(key))return json({error:'bundle_idempotency_required'},400);
 try{
 const reserved=await reserveIds(actor,createHash('sha256').update(key+'_bundle_ids').digest('hex'),request?.headers.get('X-Artifactbin-Account'));
 const pageId=existingPageId??body.reserved_id??reserved[99];
 const assetAddress=(id:string,revision:string)=>`/a/${pageId}/assets?dependency=${id}&revision=${revision}`;
 let position=0;
 const result=await publishBundleDependencies(plan,key,{
  async reuse(_path,mapping){
   if(!mapping||!['asset','dataset'].includes(mapping.kind)||!/^[A-Za-z0-9]{6,128}$/.test(mapping.id)||!/^\d+$/.test(mapping.revision))throw Error('Invalid dependency mapping');
   const row=await getOwnedArtifactFor(actor,mapping.id);
   if(!row||String(row.version)!==mapping.revision||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency mapping ownership or revision conflict');
   return mapping.kind==='dataset'?'ref:'+row.id:assetAddress(row.id,String(row.version));
  },
  async update(input,mapping){
   const row=await getOwnedArtifactFor(actor,mapping.id);if(!row||mapping.kind!==input.kind||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency update ownership or kind conflict');
   const payload:Record<string,unknown>={expectedVersion:Number(mapping.revision),...(mapping.state?{expectedState:mapping.state}:{}),...(input.kind==='dataset'?{dataset:Buffer.from(input.base64,'base64').toString('utf8')}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const response=await update(mapping.id,payload,createHash('sha256').update(input.key+'_update').digest('hex'));const saved=await response.json() as Record<string,unknown>;
   if(!response.ok||typeof saved.id!=='string')throw Error(typeof saved.error==='string'?saved.error:'Dependency update failed');
   const revision=String(saved.version);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
  async create(input){
   const requestKey=createHash('sha256').update(input.key).digest('hex');
   const headers=new Headers(request?.headers);headers.set('Idempotency-Key',requestKey);
   const dependencyBody:Record<string,unknown>={reserved_id:reserved[position++],visibility:body.visibility??'unlisted',...(body.shares?{shares:body.shares}:{}),...(body.destination?{destination:body.destination}:{}),...(input.kind==='dataset'?{dataset:Buffer.from(input.base64,'base64').toString('utf8')}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const response=await create(dependencyBody,new Request(base+'/api/artifacts',{method:'POST',headers}));
   const saved=await response.json() as Record<string,unknown>;if(!response.ok||typeof saved.id!=='string')throw Error(typeof saved.error==='string'?saved.error:'Dependency publication failed');
   const revision=String(saved.version??1);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
 },bundle.mappings);
 const next:Record<string,unknown>={...body,reserved_id:body.reserved_id??reserved[99],html:result.html};delete next.publicationBundle;return {body:next,receipts:result.receipts};
 }catch(error){return json({error:'dependency_publication_incomplete',details:[error instanceof Error&&error.cause instanceof Error?error.cause.message:String(error)],dependencyReceipts:(error as {receipts?:unknown[]}).receipts??[]},409);}
}
