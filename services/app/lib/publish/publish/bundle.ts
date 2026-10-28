import {createHash} from 'node:crypto';
import type {TokenHoldingActor} from '@/lib/accounts';
import {getArtifactById,getArtifactFor,recoverCreationIds,reserveIds} from '@/lib/artifacts';
import {json} from '@/lib/http';
import {changedBundlePaths,planPublicationBundle,publishBundleDependencies,type PublicationBundle} from '@/lib/html-publication-bundle';
/** A bundle file the actor may not write, named by its project path. */
class BundleFileRefusal extends Error {constructor(readonly code:'bundle_file_not_editable'|'bundle_file_not_creatable',readonly path:string){super(code);}}
/**
 * The saved page a bundle replaces. `creator` owns every NEW file (the page owner,
 * even when an editor saves); `dependencies` are the page's recorded receipts, the
 * only mappings reused without an edit-access check.
 */
export interface BundlePage {id:string;resolvedBackendNames:readonly string[];dependencies:readonly unknown[];creator:TokenHoldingActor;newFilesRefused?:boolean}
const MAPPING_ID=/^[A-Za-z0-9]{6,128}$/;
export async function preparePublicationBundle(body:Record<string,unknown>,actor:TokenHoldingActor,base:string,request:Request|undefined,create:(body:Record<string,unknown>,request:Request)=>Promise<Response>,update:(id:string,body:Record<string,unknown>,key:string)=>Promise<Response>,page?:BundlePage):Promise<{body:Record<string,unknown>;receipts:unknown[]}|Response>{
 if(typeof body.html!=='string')return body.publicationBundle===undefined?{body,receipts:[]}:json({error:'invalid_publication_bundle'},400);
 let plan;const bundle=body.publicationBundle as PublicationBundle|undefined;
 try{plan=planPublicationBundle(body.html,bundle??{entryPath:'index.html',files:[]},{resolvedBackendNames:[...page?.resolvedBackendNames??[],...Object.entries(body.backendSources??{}).filter(([,source])=>typeof source==='string').map(([name])=>name)]});}catch(error){return json({error:'unresolved_publication_dependencies',details:[(error as Error).message]},400);}
 if(Object.keys(plan.backendSources).length){
  const explicit=body.backendSources as Record<string,unknown>|undefined;
  if(explicit&&Object.entries(plan.backendSources).some(([name,source])=>explicit[name]!==undefined&&explicit[name]!==source))return json({error:'conflicting_backend_sources'},400);
  body={...body,backendSources:{...explicit,...plan.backendSources}};
 }
 if(!bundle)return {body,receipts:[]};
 const key=request?.headers.get('Idempotency-Key');if(!key||!/^[-_A-Za-z0-9]{16,128}$/.test(key))return json({error:'bundle_idempotency_required'},400);
 // Each file is authorized on its own, before anything is written: a recorded,
 // unchanged dependency needs nothing more; a changed or newly mapped one needs
 // edit access to its artifact; a new file is created as the page owner.
 const mappings=bundle.mappings??{},changed=changedBundlePaths(plan,mappings);
 const recorded=new Set((page?.dependencies??[]).flatMap(entry=>{const receipt=entry as {id?:unknown;revision?:unknown};return typeof receipt?.id==='string'&&typeof receipt.revision==='string'?[receipt.id+'@'+receipt.revision]:[];}));
 const reusable=(path:string,mapping:{id:string;revision:string})=>!changed.has(path)&&recorded.has(mapping.id+'@'+mapping.revision);
 for(const path of Object.keys(mappings).sort()){
  const mapping=mappings[path]!;
  if(typeof mapping?.id!=='string'||!MAPPING_ID.test(mapping.id)||reusable(path,mapping))continue;
  if(!await getArtifactFor(actor,mapping.id))return json({error:'bundle_file_not_editable',path},403);
 }
 const added=page?.newFilesRefused?plan.dependencies.find(dependency=>!mappings[dependency.path]):undefined;
 if(added)return json({error:'bundle_file_not_creatable',path:added.path},403);
 // New files belong to the page owner, so their identities are reserved and
 // recovered in the owner's namespace. An editor's account pin names the editor.
 const creator=page?.creator??actor,account=creator===actor?request?.headers.get('X-Artifactbin-Account'):null;
 try{
 const reserved=await reserveIds(creator,createHash('sha256').update(key+'_bundle_ids').digest('hex'),account);
 const pageId=page?.id??body.reserved_id??reserved[99];
 const assetAddress=(id:string,revision:string)=>`/a/${pageId}/assets?dependency=${id}&revision=${revision}`;
 const dependencyKey=(path:string)=>createHash('sha256').update(key+'_'+Buffer.from(path).toString('base64url')).digest('hex');
 const paths=[...new Set([...plan.dependencies.map(dependency=>dependency.path),...Object.keys(bundle.mappings??{})])].sort();
 // Older requests allocated IDs in traversal order. Recover those exact IDs before
 // assigning unused slots, then let each normal create validate its complete payload.
 const recovered=await recoverCreationIds(creator,base,paths.map(dependencyKey),account);
 const used=new Set([...recovered.values(),...Object.values(bundle.mappings??{}).map(mapping=>mapping.id)]),reservedByPath=new Map<string,string>();
 for(const [index,path] of paths.entries()){
  const existing=recovered.get(dependencyKey(path));if(existing){reservedByPath.set(path,existing);continue;}
  if(bundle.mappings?.[path])continue;
  const preferred=reserved[index];
  const id=preferred&&preferred!==reserved[99]&&!used.has(preferred)?preferred:reserved.find(candidate=>candidate!==reserved[99]&&!used.has(candidate));
  if(!id)throw Error('Dependency ID allocation exhausted');
  used.add(id);reservedByPath.set(path,id);
 }

 const result=await publishBundleDependencies(plan,key,{
  async reuse(path,mapping){
   if(!mapping||!['asset','dataset'].includes(mapping.kind)||!MAPPING_ID.test(mapping.id)||!/^\d+$/.test(mapping.revision))throw Error('Invalid dependency mapping');
   const row=reusable(path,mapping)?await getArtifactById(mapping.id):await getArtifactFor(actor,mapping.id);
   if(!row&&!reusable(path,mapping))throw new BundleFileRefusal('bundle_file_not_editable',path);
   if(!row||String(row.version)!==mapping.revision||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency mapping ownership or revision conflict');
   return mapping.kind==='dataset'?'ref:'+row.id:assetAddress(row.id,String(row.version));
  },
  async update(input,mapping){
   const row=await getArtifactFor(actor,mapping.id);if(!row)throw new BundleFileRefusal('bundle_file_not_editable',input.path);
   if(mapping.kind!==input.kind||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency update ownership or kind conflict');
   const payload:Record<string,unknown>={expectedVersion:Number(mapping.revision),...(mapping.state?{expectedState:mapping.state}:{}),...(input.kind==='dataset'?{dataset:Buffer.from(input.base64,'base64').toString('utf8')}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const response=await update(mapping.id,payload,createHash('sha256').update(input.key+'_update').digest('hex'));const saved=await response.json() as Record<string,unknown>;
   if(!response.ok||typeof saved.id!=='string')throw Error(typeof saved.error==='string'?saved.error:'Dependency update failed');
   const revision=String(saved.version);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
  async create(input){
   const requestKey=createHash('sha256').update(input.key).digest('hex');
   const headers=new Headers(request?.headers);headers.set('Idempotency-Key',requestKey);if(creator!==actor)headers.delete('X-Artifactbin-Account');
   const dependencyBody:Record<string,unknown>={reserved_id:reservedByPath.get(input.path),visibility:body.visibility??'unlisted',...(body.shares?{shares:body.shares}:{}),...(body.destination?{destination:body.destination}:{}),...(input.kind==='dataset'?{dataset:Buffer.from(input.base64,'base64').toString('utf8')}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const response=await create(dependencyBody,new Request(base+'/api/artifacts',{method:'POST',headers}));
   const saved=await response.json() as Record<string,unknown>;if(!response.ok||typeof saved.id!=='string')throw Error(typeof saved.error==='string'?saved.error:'Dependency publication failed');
   const revision=String(saved.version??1);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
 },bundle.mappings);
 const next:Record<string,unknown>={...body,reserved_id:body.reserved_id??reserved[99],html:result.html};delete next.publicationBundle;return {body:next,receipts:result.receipts};
 }catch(error){
  const cause=error instanceof Error?error.cause:undefined;
  if(cause instanceof BundleFileRefusal)return json({error:cause.code,path:cause.path,dependencyReceipts:(error as {receipts?:unknown[]}).receipts??[]},403);
  return json({error:'dependency_publication_incomplete',details:[error instanceof Error&&error.cause instanceof Error?error.cause.message:String(error)],dependencyReceipts:(error as {receipts?:unknown[]}).receipts??[]},409);}
}
