import {createHash} from 'node:crypto';
import type { PublicationActor } from '@/lib/accounts';
import {getArtifactById,getArtifactFor,recoverCreationIds,reserveIds} from '@/lib/artifacts';
import {Reply,reply,thrownMessage} from '@/lib/http';
import {changedBundlePaths,planPublicationBundle,publishBundleDependencies,type PublicationBundle} from '@/lib/html-publication-bundle';
import {parseCsv} from '@/lib/data-ingest';
import {FILE_EXTENSIONS} from '@artifactbin/contracts';
/** A bundle file the actor may not write, named by its project path. */
class BundleFileRefusal extends Error {constructor(readonly code:'bundle_file_not_editable'|'bundle_file_not_creatable',readonly path:string){super(code);}}
/**
 * The saved page a bundle replaces. `creator` owns every NEW file (the page owner,
 * even when an editor saves); `dependencies` are the page's recorded receipts, the
 * only mappings reused without an edit-access check.
 */
/** What a creation reads of its request (lib/publish requests): the idempotency key it replays under, the account it is pinned to. */
export interface CreationKeys {idempotencyKey?:string|null;account?:string|null}
export interface BundlePage {id:string;dependencies:readonly unknown[];creator:PublicationActor;newFilesRefused?:boolean}
const MAPPING_ID=/^[A-Za-z0-9]{6,128}$/;
const ok=(answer:Reply)=>answer.status>=200&&answer.status<300;
/** Why a project file cannot publish with its page, and what to do instead. */
const unsupportedFile=(path:string):string=>/\.html?$/i.test(path)?`unsupported_file_type: ${path} is a page: publish it on its own and link its address`:`unsupported_file_type: ${path}; a page publishes files of these types: ${FILE_EXTENSIONS.join(', ')}`;
/**
 * A CSV a page links by path is named by its file, as a CSV published alone is: its title is the file name and its
 * dataset title; a header with no rows is an empty table of those columns.
 */
function csvDatasetFields(path:string,csv:string):{title:string;columns?:{name:string;type:'string'}[]}{
 const file=path.split('/').at(-1)!;
 const {headers,rows}=parseCsv(csv);
 return {title:file,...(headers.length&&!rows.length?{columns:headers.map(name=>({name,type:'string' as const}))}:{})};
}
export async function preparePublicationBundle(body:Record<string,unknown>,actor:PublicationActor,base:string,keys:CreationKeys,create:(body:Record<string,unknown>,keys:CreationKeys)=>Promise<Reply>,update:(id:string,body:Record<string,unknown>,key:string)=>Promise<Reply>,page?:BundlePage):Promise<{body:Record<string,unknown>;receipts:unknown[];entryPath?:string}|Reply>{
 if(typeof body.html!=='string')return body.publicationBundle===undefined?{body,receipts:[]}:reply({error:'invalid_publication_bundle'},400);
 let plan;const bundle=body.publicationBundle as PublicationBundle|undefined;
 try{plan=planPublicationBundle(body.html,bundle??{entryPath:'index.html',files:[]},{linksAsWritten:!bundle});}catch(error){return reply({error:'unresolved_publication_dependencies',details:[(error as Error).message]},400);}
 if(!bundle)return {body,receipts:[]};
 const key=keys.idempotencyKey;if(!key||!/^[-_A-Za-z0-9]{16,128}$/.test(key))return reply({error:'bundle_idempotency_required'},400);
 // Each file is authorized on its own, before anything is written: a recorded,
 // unchanged dependency needs nothing more; a changed or newly mapped one needs
 // edit access to its artifact; a new file is created as the page owner.
 const mappings=bundle.mappings??{},changed=changedBundlePaths(plan,mappings);
 const recorded=new Set((page?.dependencies??[]).flatMap(entry=>{const receipt=entry as {id?:unknown;revision?:unknown};return typeof receipt?.id==='string'&&typeof receipt.revision==='string'?[receipt.id+'@'+receipt.revision]:[];}));
 const reusable=(path:string,mapping:{id:string;revision:string})=>!changed.has(path)&&recorded.has(mapping.id+'@'+mapping.revision);
 for(const path of Object.keys(mappings).sort()){
  const mapping=mappings[path]!;
  if(typeof mapping?.id!=='string'||!MAPPING_ID.test(mapping.id)||reusable(path,mapping))continue;
  if(!await getArtifactFor(actor,mapping.id))return reply({error:'bundle_file_not_editable',path},403);
 }
 const added=page?.newFilesRefused?plan.dependencies.find(dependency=>!mappings[dependency.path]):undefined;
 if(added)return reply({error:'bundle_file_not_creatable',path:added.path},403);
 // New files belong to the page owner, so their identities are reserved and
 // recovered in the owner's namespace. An editor's account pin names the editor.
 const creator=page?.creator??actor,account=creator===actor?keys.account:null;
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
   // An unchanged file keeps what it published. An asset is served at its exact revision, so it must still be that
   // one. A dataset is linked live (`ref:ID`) and is written to after publish (the page's sql):
   // its head moving past the recorded revision is the dataset being used, not a conflict, and an unchanged CSV is
   // never re-imported over those rows. A CHANGED CSV takes `update`: a conditional replace of the recorded revision,
   // refused when a newer one exists (the content write's expectedVersion/expectedState), so newer rows are never overwritten.
   const moved=mapping.kind==='dataset'?!!row&&row.version<Number(mapping.revision):!!row&&String(row.version)!==mapping.revision;
   if(!row||moved||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency mapping ownership or revision conflict');
   return mapping.kind==='dataset'?'ref:'+row.id:assetAddress(row.id,String(row.version));
  },
  async update(input,mapping){
   const row=await getArtifactFor(actor,mapping.id);if(!row)throw new BundleFileRefusal('bundle_file_not_editable',input.path);
   if(mapping.kind!==input.kind||mapping.kind==='dataset'&&row.format!=='dataset'||mapping.kind==='asset'&&!['image','file','pdf'].includes(row.format))throw Error('Dependency update ownership or kind conflict');
   const payload:Record<string,unknown>={expectedVersion:Number(mapping.revision),...(mapping.state?{expectedState:mapping.state}:{}),...(input.kind==='dataset'?{dataset:Buffer.from(input.base64,'base64').toString('utf8')}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const updated=await update(mapping.id,payload,createHash('sha256').update(input.key+'_update').digest('hex'));const saved=updated.body;
   if(!ok(updated)||typeof saved.id!=='string')throw Error(typeof saved.error==='string'?saved.error:'Dependency update failed');
   const revision=String(saved.version);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
  async create(input){
   const requestKey=createHash('sha256').update(input.key).digest('hex');
   const dependencyBody:Record<string,unknown>={reserved_id:reservedByPath.get(input.path),visibility:body.visibility??'unlisted',...(body.shares?{shares:body.shares}:{}),...(body.destination?{destination:body.destination}:{}),...(body.parent_id!==undefined?{parent_id:body.parent_id}:{}),...(input.kind==='dataset'?{title:input.path.split('/').at(-1),dataset:Buffer.from(input.base64,'base64').toString('utf8'),...(/^text\/csv\b/.test(input.contentType)?csvDatasetFields(input.path,Buffer.from(input.base64,'base64').toString('utf8')):{})}:{file:{filename:input.path.split('/').at(-1),contentType:input.contentType,base64:input.base64}})};
   const created=await create(dependencyBody,{idempotencyKey:requestKey,account});
   const saved=created.body;if(!ok(created)||typeof saved.id!=='string')throw Error(saved.error==='unsupported_file_type'?unsupportedFile(input.path):typeof saved.error==='string'?saved.error:'Dependency publication failed');
   const revision=String(saved.version??1);return {id:saved.id,revision,state:typeof saved.state==='string'?saved.state:undefined,address:input.kind==='dataset'?'ref:'+saved.id:assetAddress(saved.id,revision)};
  },
 },bundle.mappings);
 const next:Record<string,unknown>={...body,reserved_id:body.reserved_id??reserved[99],html:result.html};delete next.publicationBundle;return {body:next,receipts:result.receipts,entryPath:plan.entryPath};
 }catch(error){
  const cause=error instanceof Error?error.cause:undefined;
  if(cause instanceof BundleFileRefusal)return reply({error:cause.code,path:cause.path,dependencyReceipts:(error as {receipts?:unknown[]}).receipts??[]},403);
  return reply({error:'dependency_publication_incomplete',details:[error instanceof Error&&error.cause instanceof Error?error.cause.message:error instanceof Error?`${error.name}${error.message?': '+error.message:''}`:thrownMessage(error,'Dependency publication failed')],dependencyReceipts:(error as {receipts?:unknown[]}).receipts??[]},409);}
}
