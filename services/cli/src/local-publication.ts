import {accountMismatch} from './account-diagnostic';
import {prepareBindings,assertBindingInputs,installBindings,deliverBound,finalizeBindings,projectBindingConflicts} from './publication-binding';
import {withLocalLock} from './local-workspace';
/**
 * Offline drafts publish through a recoverable projection and retain their local IDs.
 * Published authoring files retain their remote identity and accepted baseline.
 * The existing push journal remains the single HTTP write protocol.
 */
import {mkdir,readFile} from 'node:fs/promises';
import {dirname,extname,join,relative,resolve,sep} from 'node:path';
import {CliError} from './commands';
import {withPrivateStateHome} from './config';
import {digest,readOptional,atomicWrite} from './files';
import {confinedPath} from './journal';
import {localIdentities,addFiles,moveFile} from './identities';
import {parseDocument,writeDocument,metadataFields} from './document';
import {parseResourceFile,writeResourceFile,readResourceSource} from './resource-file';
import {referenceIds} from './preview/graph';
import {datasetFileRows,datasetFileBytes,isDatasetFile} from './dataset-file';
import {reconcileDocument} from './reconcile';
import {stampNodeIds,graphSource,canonicalizeMarkup,parseJsx,serializeJsx,type JsxNode,collectRefUses,REFERENCE_POSITIONS,validateMarkupStructure} from '../../app/lib/cli-toolkit';
import {push} from './sync';
import {validateFiles} from './validation';
import {loadWorkspace,saveTracking,type Workspace,type Snapshot} from './workspace';
import {stateFor} from './state-access';
import {withLock} from './state';
import {readPendingRequest} from './pending-request';
import {readLocalWorkspaceState,LOCAL_WORKSPACE_SCOPE} from './local-workspace';
import {snapshotDocument} from './local';
import {ARTIFACT_ID_PATTERN,type DocumentGraph} from '@artifactbin/contracts';
import type {HttpClient} from './http';
import {publishLocalComments} from './local-comment-publication';
interface LocalPublicationResult {operations:Array<Record<string,unknown>>;dry_run?:boolean;local_only?:boolean;publication_copy?:string;local_source_preserved?:boolean}
interface Options {force?:boolean;dryRun?:boolean;access?:'read'|'readwrite';policy?:'viewers-write'|'none'}
interface Input {localId?:string;bytes:string;hash:string;ids?:Record<string,string>}
interface ImportedBaseline {artifactId:string;origin:string;base:{version:number;editId:string;source:string};source:string}
function validImportedBaseline(baseline:ImportedBaseline):boolean{
 return typeof baseline.artifactId==='string'&&ARTIFACT_ID_PATTERN.test(baseline.artifactId)&&!!baseline.base&&Number.isSafeInteger(baseline.base.version)&&baseline.base.version>0&&typeof baseline.base.source==='string'&&typeof baseline.base.editId==='string'&&!!baseline.base.editId;
}
interface ArchivedDocument {artifact_id:string;version:number;markup:string;format:string;document:DocumentGraph;title?:string|null;description?:string|null;meta?:Record<string,unknown>}
/** The imported bytes never supply a trusted graph. Obtain the original author's
 * graph through the authenticated history door, then retain its dependency versions.
 * The current head contributes identity/permission and current sharing, not source. */
async function importedAuthoringBase(head:Snapshot,baseline:ImportedBaseline,path:string,client:HttpClient):Promise<Snapshot>{
 const refusal=()=>new CliError('import_conflict',`The downloaded baseline for ${path} cannot be verified.`,
  'Preserve your local proposal and obtain its original authenticated source before resolving.',{path,base:baseline.base?.source,remote:head.markup});
 if(!validImportedBaseline(baseline)||baseline.base.version>head.version)throw refusal();
 let base:Snapshot=head;
 if(head.version!==baseline.base.version){
  const archived=await client.request<ArchivedDocument>(`/artifacts/${head.id}/versions/${baseline.base.version}`);
  if(archived.artifact_id!==head.id||archived.version!==baseline.base.version||archived.format!=='markup'||typeof archived.markup!=='string')throw refusal();
  base={...head,version:archived.version,markup:archived.markup,document:archived.document,
   title:archived.title??null,description:archived.description??null,
   theme:(archived.meta?.theme as Snapshot['theme'])??null,template:(archived.meta?.template as Snapshot['template'])??null,colorMode:archived.meta?.colorMode??null};
 }else if(head.edit_id!==baseline.base.editId)throw refusal();
 const document=base.document as DocumentGraph|undefined;
 if(document?.schema!==3||document.kind!=='graph'||canonicalizeMarkup(base.markup!)!==canonicalizeMarkup(baseline.base.source))throw refusal();
 try{if(canonicalizeMarkup(graphSource(document))!==canonicalizeMarkup(baseline.base.source))throw refusal();}catch{throw refusal();}
 return base;
}
interface Publication {format:1;server:string;account:string;root:string;inputs:Record<string,Input>;ids:Record<string,string>}
const fence=['id','edit_id','head_version','state','version'] as const;
/** Only entire resource-address values carry an identity; prose never does. */
function rewriteAddress(value:string,ids:Record<string,string>):string{
 const match=/^(ref:|\/a\/)([A-Za-z0-9]{6,12})$/.exec(value);
 return match&&ids[match[2]!]?match[1]+ids[match[2]!]:value;
}
function rewriteRows(value:unknown,ids:Record<string,string>):unknown{
 if(typeof value==='string')return rewriteAddress(value,ids);
 if(Array.isArray(value))return value.map(item=>rewriteRows(item,ids));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewriteRows(item,ids)]));
 return value;
}
/** The same semantic slots publication validates, plus local document links. */
function rewriteMarkup(source:string,ids:Record<string,string>):string{
 const parsed=parseJsx(source);if(!parsed.ok)throw new CliError('invalid_markup','Cannot rewrite references in invalid JSX.');let changed=false;
 const walk=(nodes:JsxNode[])=>{for(const node of nodes)if(node.type==='element'){
  const tag=node.isComponent?node.tag:node.tag.toLowerCase();
  const semantic=new Set(REFERENCE_POSITIONS.filter(position=>position.component===node.isComponent&&position.tag===tag).map(position=>position.attribute));
  if(node.tag!=='Iframe'&&tag!=='iframe')semantic.add('href');
  if(node.isComponent&&['Query','Notify','Value'].includes(node.tag))semantic.add('source');
  if(node.isComponent&&node.tag==='Import')semantic.add('src');
  if(!node.isComponent&&tag==='meta'&&node.attributes.some(attr=>attr.name==='name'&&attr.value.static&&['artifactbin:og-image','artifactbin:pwa-icon'].includes(String(attr.value.json))))semantic.add('content');
  for(const attr of node.attributes){
   if(!attr.value.static)continue;const original=attr.value.json;let next:unknown=original;
   if(typeof original==='string'&&semantic.has(attr.name.toLowerCase())){
    const list=REFERENCE_POSITIONS.some(position=>position.component===node.isComponent&&position.tag===tag&&position.attribute===attr.name.toLowerCase()&&position.list);
    if(list)next=original.replace(/(^|[\s,])((?:ref:|\/a\/)[A-Za-z0-9]{6,12})(?=[\s,]|$)/g,(_whole,prefix:string,pointer:string)=>prefix+rewriteAddress(pointer,ids));
    else next=rewriteAddress(original,ids);
   }else if(attr.name==='viz'&&original&&typeof original==='object'&&!Array.isArray(original)){
    const viz=original as Record<string,unknown>;if(typeof viz.recipe==='string')next={...viz,recipe:rewriteAddress(viz.recipe,ids)};
   }else if(node.isComponent&&node.tag==='Table'&&attr.name==='rows')next=rewriteRows(original,ids);
   if(JSON.stringify(next)!==JSON.stringify(original)){attr.value.json=next as typeof original;changed=true;}
  }
  walk(node.children);
 }};walk(parsed.nodes);return changed?serializeJsx(parsed.nodes):source;
}
function rowReferences(value:unknown):Set<string>{
 const found=new Set<string>();const visit=(item:unknown)=>{if(typeof item==='string'){const match=/^(?:ref:|\/a\/)([A-Za-z0-9]{6,12})$/.exec(item);if(match)found.add(match[1]!);}else if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==='object')Object.values(item).forEach(visit);};visit(value);return found;
}
/** Navigation selects documents, but only data/resource references constrain write order. */
async function dependencies(workspace:Workspace,paths:string[],identities:Record<string,string>):Promise<{paths:string[];sources:string[]}>{
 const sources=new Set<string>(),edges=new Map<string,string[]>();
 function markupReferences(body:string):{all:Set<string>;required:Set<string>}{
  return{all:referenceIds(body),required:new Set((collectRefUses(body)??[]).filter(ref=>ref.kind!=='asset').map(ref=>ref.id))};
 }
 async function discover(path:string):Promise<string>{
  path=relative(workspace.root,await confinedPath(workspace.root,path)).split(sep).join('/');
  if(path.split('/').includes('.artifactbin'))throw new CliError('invalid_path','Workspace state cannot be published as content.');
  if(edges.has(path))return path;
  const required:string[]=[];edges.set(path,required);
  const bytes=await readFile(await confinedPath(workspace.root,path)),extension=extname(path).toLowerCase();
  let all=new Set<string>(),strong=all;
  if(extension==='.jsx'){
   const body=parseDocument(bytes.toString()).body,checked=validateMarkupStructure(body);
   if(checked.errors.length){
    const validation=await validateFiles(workspace,[resolve(workspace.root,path)],false,{repairSyntax:false});
    throw new CliError('validation_failed',`Local validation failed for ${path}.`,'Correct the source before publishing.',validation);
   }
   const refs=markupReferences(body);all=refs.all;strong=refs.required;
  }else if(isDatasetFile(path))all=strong=rowReferences(datasetFileRows(path,bytes));
  else if(['.yaml','.yml'].includes(extension)){
   const resource=parseResourceFile(bytes.toString()),source=await readResourceSource(resource,path,workspace.root);
   if(source){
    if(source.path.split(sep).includes('.artifactbin'))throw new CliError('invalid_path','Workspace state cannot be a publication source.');
    sources.add(source.path.split(sep).join('/'));const content=Buffer.from(source.bytes,'base64');
    if(extname(source.path).toLowerCase()==='.jsx'){const refs=markupReferences(parseDocument(content.toString()).body);all=refs.all;strong=refs.required;}
    else if(isDatasetFile(source.path))all=strong=rowReferences(datasetFileRows(source.path,content));
   }
   if(typeof resource.folder==='string'){all.add(resource.folder);strong.add(resource.folder);}
  }
  for(const id of all)if(identities[id]){const target=await discover(identities[id]!);if(strong.has(id))required.push(target);}
  return path;
 }
 for(const path of paths.length?paths:Object.values(identities))await discover(resolve(workspace.cwd,path));
 const ordered:string[]=[],active=new Set<string>(),done=new Set<string>();
 const order=(path:string)=>{
  if(done.has(path))return;if(active.has(path))throw new CliError('dependency_cycle',`Cyclic publication dependency: ${path}.`);
  active.add(path);for(const dependency of edges.get(path)??[])order(dependency);active.delete(path);done.add(path);ordered.push(path);
 };
 for(const path of edges.keys())order(path);
 // A resource's companion belongs to that resource, even when explicitly
 // registered/selected alongside it. It never acquires a second remote identity.
 return{paths:ordered.filter(path=>!sources.has(path)),sources:[...sources]};
}
async function saveManifest(path:string,manifest:Publication):Promise<void>{
 await atomicWrite(path,JSON.stringify(manifest,null,2)+'\n');
}
function mappedBytes(path:string,bytes:Buffer,ids:Record<string,string>,remote?:Buffer):Buffer{
 const extension=extname(path).toLowerCase();
 if(extension==='.jsx'){
  const local=parseDocument(bytes.toString());const metadata={...local.metadata};for(const key of fence)delete metadata[key];
  if(remote){const previous=parseDocument(remote.toString());for(const key of fence)if(previous.metadata[key]!==undefined)Object.assign(metadata,{[key]:previous.metadata[key]});}
  return Buffer.from(writeDocument({...local,metadata,body:rewriteMarkup(local.body,ids)}));
 }
 if(['.yaml','.yml'].includes(extension)){
  const resource=parseResourceFile(bytes.toString());for(const key of fence)delete resource[key];
  if(remote){const previous=parseResourceFile(remote.toString());for(const key of fence)if(previous[key]!==undefined)Object.assign(resource,{[key]:previous[key]});}
  if(typeof resource.folder==='string'&&ids[resource.folder])resource.folder=ids[resource.folder]!;
  return Buffer.from(writeResourceFile(resource));
 }
 if(isDatasetFile(path)){
  const rows=datasetFileRows(path,bytes);return datasetFileBytes(path,rewriteRows(rows,ids) as typeof rows);
 }
 return bytes;
}
export async function publishLocalWorkspace(workspace:Workspace,paths:string[],client:HttpClient,options:Options={}):Promise<LocalPublicationResult>{
 if(options.dryRun)return publishProjection(workspace,paths,client,options);
 return withLocalLock(workspace.root,()=>withLock(workspace.home,workspace.root,async()=>{
  await finalizeBindings(workspace);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  return publishProjection(workspace,paths,client,options);
 }));
}
async function publishProjection(workspace:Workspace,paths:string[],client:HttpClient,options:Options):Promise<LocalPublicationResult>{
 const publication=join(workspace.root,'.artifactbin','publications',digest(client.connection.server).slice(0,24));
 await confinedPath(workspace.root,publication);
 const manifestPath=join(publication,'manifest.json'),home=join(publication,'private'),root=join(publication,'files');
 const existing=await readOptional(manifestPath),stored:Publication|undefined=existing?JSON.parse(existing.toString()):undefined;
 const identities=await localIdentities(workspace),aliases:Record<string,string>={};
 // Canonicalized bound parents refer to published IDs; their offline children
 // still own local IDs. Manifest aliases are discovery only, never ownership.
 for(const [localId,remoteId] of Object.entries(stored?.ids??{}))if(identities[localId]&&!identities[remoteId])aliases[remoteId]=identities[localId]!;
 const graph=await dependencies(workspace,paths,{...aliases,...identities}),ordered=graph.paths;
 if(options.dryRun)return{dry_run:true,local_only:true,operations:ordered.map(path=>({path,status:'would_publish'}))};

 if(stored&&(stored.format!==1||typeof stored.server!=='string'||typeof stored.account!=='string'||!stored.account))throw new CliError('invalid_journal','This publication copy has invalid ownership metadata.');
 if(workspace.tracking&&!client.sameServer(workspace.tracking.server))throw new CliError('wrong_server','The authoring baseline belongs to another server.');
 if(stored&&!client.sameServer(stored.server))throw new CliError('wrong_server','This publication copy belongs to another server.');
 if(stored&&client.account!==stored.account){
  const previousAccount=client.account;client.account=stored.account;
  try{
   // The authenticated server verifies this historical guest/account pin and
   // echoes it only for the same owner or a verified guest adoption alias.
   await client.request('/artifacts?limit=1');
  }catch(error){client.account=previousAccount;throw error;}
 }
 if(!client.account)await client.request('/artifacts?limit=1');
 if(!client.account)throw new CliError('account_required','Publication requires an authenticated account.');
 let manifest:Publication=stored??{format:1,server:client.connection.server,account:client.account,root,inputs:{},ids:{}};
 if(manifest.format!==1)throw new CliError('invalid_journal','Invalid publication format.');
  if(!client.sameServer(manifest.server))throw new CliError('wrong_server','This publication copy belongs to another server.');
  if(manifest.account!==client.account)throw accountMismatch(manifest.account,client.account,client.connection.server,workspace);
 const imported:Array<{path:string;localId:string;head:Snapshot;base:Snapshot;baseline:ImportedBaseline}>=[];
 const portable=await readLocalWorkspaceState(workspace.root),pathIds=Object.fromEntries(Object.entries(identities).map(([id,path])=>[path,id]));
 let bindings=await prepareBindings(workspace,ordered,pathIds,manifest,client);
 for(const path of ordered){
  const baseline=portable?.get<ImportedBaseline>(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+path)?.value;
  if(!baseline)continue;
  if(typeof baseline.origin!=='string'||!client.sameServer(baseline.origin))throw new CliError('import_server_mismatch',`The imported ${path} belongs to another server.`,'Select the original server before publishing.');
  const localId=pathIds[path];if(!localId||manifest.ids[localId])continue;
  if(!validImportedBaseline(baseline))throw new CliError('import_conflict',`The downloaded baseline for ${path} is invalid.`,'Preserve the local proposal and obtain its original authenticated source.');
  const head=await client.request<Snapshot>(`/artifacts/${baseline.artifactId}`);
  if((head.capabilities as {edit?:boolean}|undefined)?.edit!==true)throw new CliError('edit_required',`Your account cannot edit the original artifact for ${path}.`,'Sign in with an account allowed to edit it.');
  if(head.id!==baseline.artifactId||typeof head.markup!=='string'||typeof head.edit_id!=='string'||typeof head.state!=='string'||!Number.isSafeInteger(head.version))throw new CliError('invalid_response','The original artifact snapshot is incomplete.');
  const base=await importedAuthoringBase(head,baseline,path,client);
  imported.push({path,localId,head,base,baseline});
 }
 await assertBindingInputs(workspace,bindings);
 await mkdir(root,{recursive:true,mode:0o700});
 return withPrivateStateHome(home,join(home,'.artifactbin'),()=>withLock(home,publication,async()=>{
  const latest=await readOptional(manifestPath);if(latest)manifest=JSON.parse(latest.toString());
  if(manifest.format!==1)throw new CliError('invalid_journal','Invalid publication format.');
  if(!client.sameServer(manifest.server))throw new CliError('wrong_server','This publication copy belongs to another server.');
  if(manifest.account!==client.account)throw accountMismatch(manifest.account,client.account,client.connection.server,workspace);
  // The state store travels with the workspace. Only its scope contains an
  // absolute path; rebase it before ordinary journal recovery or discovery.
  const state=await stateFor(home);if(manifest.root!==root){state.rebaseScope(manifest.root,root);manifest={...manifest,root};await saveManifest(manifestPath,manifest);}
  let stage=await loadWorkspace(root,home);
  for(const {path,localId,head,base,baseline} of imported.filter(binding=>!manifest.ids[binding.localId])){
   const target=await confinedPath(root,path);await mkdir(dirname(target),{recursive:true});const bytes=Buffer.from(writeDocument(snapshotDocument(base)));await atomicWrite(target,bytes);
   await saveTracking(stage,{server:client.connection.server,account:client.account!,set:{[path]:{id:head.id,file:digest(bytes),url:`${client.connection.server}/a/${head.id}`,snapshot:base}}});
   manifest.ids[localId]=head.id;
   const local=parseDocument((await readFile(await confinedPath(workspace.root,path))).toString());const original=Buffer.from(writeDocument({...local,metadata:{...local.metadata,...snapshotDocument(base).metadata,id:local.metadata.id},body:baseline.base.source}));
   manifest.inputs[path]={localId,bytes:original.toString('base64'),hash:digest(original),ids:{}};
  }
  if(imported.length){await saveManifest(manifestPath,manifest);stage=await loadWorkspace(root,home);}
  if(await readPendingRequest(home,root)){
   await deliverBound(workspace,bindings,manifest,()=>push(stage,[],client,{}));await finalizeBindings(workspace);workspace=await loadWorkspace(workspace.cwd,workspace.home);stage=await loadWorkspace(root,home);bindings=await prepareBindings(workspace,ordered,pathIds,manifest,client);
  }
  await assertBindingInputs(workspace,bindings);
  const frozen:Record<string,Buffer>={};
  for(const path of ordered)frozen[path]=bindings.find(binding=>binding.path===path)?.bytes??await readFile(await confinedPath(workspace.root,path));
  for(const path of graph.sources){const source=bindings.find(binding=>binding.source?.path===path)?.source;frozen[path]=source?Buffer.from(source.bytes,'base64'):await readFile(await confinedPath(workspace.root,path));}
  await installBindings(workspace,stage,bindings,manifest);await saveManifest(manifestPath,manifest);stage=await loadWorkspace(root,home);
  const reverse=Object.fromEntries(Object.entries(identities).map(([id,path])=>[path,id]));
  const stageIds=await localIdentities(stage);
  for(const path of ordered){
   const localId=reverse[path],remoteId=localId&&manifest.ids[localId],oldPath=remoteId&&stageIds[remoteId];
   if(oldPath&&oldPath!==path){
    if(await readOptional(await confinedPath(root,path)))throw new CliError('publication_path_conflict',`The publication copy already contains ${path}.`);
    await mkdir(dirname(await confinedPath(root,path)),{recursive:true});
    await moveFile(stage,oldPath,path);stage=await loadWorkspace(root,home);
   }
   const prior=localId&&Object.entries(manifest.inputs).find(([previous,input])=>previous!==path&&input.localId===localId);
   if(prior){manifest.inputs[path]=prior[1];delete manifest.inputs[prior[0]];}
  }
  await saveManifest(manifestPath,manifest);
  // Resource YAML points at a source file, not a second artifact. Preserve its
  // path spelling and rewrite only resource addresses inside the source copy.
  for(const path of graph.sources){
   const target=await confinedPath(root,path);await mkdir(dirname(target),{recursive:true});
   const bytes=frozen[path]!;await atomicWrite(target,bytes);
  }
  // Materialize unassigned copies first so addFiles can recover its own
  // reservation pool after an interruption. Never carry a local fence to HTTP.
  for(const path of ordered){
   const target=await confinedPath(root,path),bytes=frozen[path]!;
   if(!Object.values(await localIdentities(stage)).includes(path)){await mkdir(dirname(target),{recursive:true});await atomicWrite(target,mappedBytes(path,bytes,manifest.ids));}
  }
  const registered=Object.fromEntries(Object.entries(await localIdentities(stage)).map(([id,path])=>[path,id]));
  const assigned={...registered,...await addFiles(stage,ordered.filter(path=>!registered[path]).map(path=>join(root,path)),client)};
  for(const [path,id] of Object.entries(assigned))if(reverse[path.split(sep).join('/')])manifest.ids[reverse[path.split(sep).join('/')]!]=id;
  await saveManifest(manifestPath,manifest);stage=await loadWorkspace(root,home);
  for(const path of graph.sources){
   const target=await confinedPath(root,path),bytes=frozen[path]!;
   await atomicWrite(target,isDatasetFile(path)?mappedBytes(path,bytes,manifest.ids):extname(path).toLowerCase()==='.jsx'?Buffer.from(rewriteMarkup(bytes.toString(),manifest.ids)):bytes);
  }
  for(const path of ordered){
   const bytes=frozen[path]!,hash=digest(bytes),previous=manifest.inputs[path];if(previous?.hash===hash&&JSON.stringify(previous.ids??{})===JSON.stringify(manifest.ids))continue;
   const target=await confinedPath(root,path),remote=await readFile(target);let mapped=mappedBytes(path,bytes,manifest.ids,remote);
   const accepted=stage.tracking?.files[path]?.snapshot;
   // A refused create has no accepted normalization to merge. Its staging
   // bytes are merely the rejected proposal; stamping IDs into that invented
   // "remote" baseline makes a corrected source conflict with itself.
   // Uncertain deliveries are recovered above before newer inputs reach here.
   // Bound authoring already has the accepted canonical baseline in tracking.
   // Its ordinary push compiler handles changes; rematching an older un-IDed
   // draft can invent IDs for repeated nodes and conflict with normalization.
   if(previous&&accepted&&!bindings.some(binding=>binding.path===path)&&extname(path).toLowerCase()==='.jsx'){
    const base=parseDocument(mappedBytes(path,Buffer.from(previous.bytes,'base64'),previous.ids??manifest.ids,remote).toString());const local=parseDocument(mapped.toString()),confirmed=parseDocument(remote.toString());
    const normalized=snapshotDocument(accepted).metadata;
    // Omitted author fields acquired server defaults on the accepted create;
    // those defaults are the baseline for a later explicit metadata change.
    for(const key of metadataFields)if(base.metadata[key]===undefined&&normalized[key]!==undefined)Object.assign(base.metadata,{[key]:normalized[key]});
    // Server-assigned node IDs are normalization, not an intervening user edit.
    // Match them before computing changes; keep author originals unchanged.
    base.body=stampNodeIds(base.body,{previousSource:confirmed.body}).source;
    local.body=stampNodeIds(local.body,{previousSource:base.body}).source;
    const merged=reconcileDocument(base,local,confirmed);
    if(!merged.ok)throw new CliError('merge_conflict',`Publication normalization overlaps local changes in ${path}.`,`The readable normalized copy is ${join(relative(workspace.root,publication),'files',path)}; ${merged.fields.join(', ')} overlap your changes. Either copy the fence (id, edit_id, head_version, state) from that file into yours, or run afbin pull <id> --output <path> --force and re-apply your body.`,{base:writeDocument(base),local:writeDocument(local),remote:writeDocument(confirmed),fields:merged.fields});
    mapped=Buffer.from(writeDocument(merged.document));
   }
   await atomicWrite(target,mapped);manifest.inputs[path]={bytes:bytes.toString('base64'),hash,ids:{...manifest.ids},...(reverse[path]?{localId:reverse[path]}:{})};
  }
  // Persist the frozen local input before HTTP: retries recover exactly these
  // bytes, then stage newer local changes against the confirmed remote head.
  await saveManifest(manifestPath,manifest);
  let result:Awaited<ReturnType<typeof push>>;
  await assertBindingInputs(workspace,bindings);
  try{result=await deliverBound(workspace,bindings,manifest,()=>push(stage,ordered.map(path=>join(root,path)),client,options));}
  catch(error){await projectBindingConflicts(workspace,stage,bindings);throw error;}
  await finalizeBindings(workspace);
  try{const comments=await publishLocalComments(workspace,await loadWorkspace(root,home),ordered,client,options);return{...result,operations:[...result.operations,...comments],publication_copy:relative(workspace.root,publication),local_source_preserved:bindings.length===0};}
  catch(error){if(error instanceof CliError)throw new CliError(error.code,error.message,error.fix,{...(error.details&&typeof error.details==='object'?error.details:{}),completed_operations:[...result.operations,...((error.details as {completed_operations?:Array<Record<string,unknown>>}|undefined)?.completed_operations??[])],publication_copy:relative(workspace.root,publication),local_source_preserved:bindings.length===0},error.exitCode);throw error;}
 }));
}
