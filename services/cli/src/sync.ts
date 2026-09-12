import type {PreflightDependencyResult} from '@artifactbin/contracts';
import {readConflicts,persistConflict,clearConflict} from './conflict-state';
import {isDeepStrictEqual} from 'node:util';
import {extname} from 'node:path';
import {canonicalizeMarkup} from '../../app/lib/story/canonical-source';
import {stampNodeIds} from '../../app/lib/story/node-ids';
import {CliError} from './commands';
import {digest,readOptional} from './files';
import {confinedPath,recoverFiles,stageFiles} from './journal';
import {withLock} from './state';
import {parseDocument,writeDocument,metadataFields,type DocumentMetadata} from './document';
import {snapshotDocument} from './local';
import {loadWorkspace,inspectWorkspace,saveTracking,writeTracking,type Workspace,type LocalFile,type Snapshot,type TrackedFile} from './workspace';
import {assetInput,restoreDependencyPaths,planDependencies,substituteDependencies,type Dependency} from './dependencies';
import {validateFiles} from './validation';
import {checkRetiredCreate,retireDeletedCreate,stageRequest,readPendingRequest,savePendingResponse,clearPendingRequest,type PendingRequest} from './pending-request';
import {HttpClient} from './http';
import {describeConflict} from './conflict';
import {reconcileDocument} from './reconcile';
import {parseResourceFile,readResourceSource,reconcileResource,resourceContent,snapshotResource,writeResourceFile,type ResourceSource} from './resource-file';
interface PushOptions {force?:boolean;dryRun?:boolean}
interface PushPlan {confirmed?:Snapshot;source?:ResourceSource;reconcile?:boolean;file:LocalFile;dependencies:Dependency[];ids:Record<string,string>;body:Record<string,unknown>;mode:'create'|'edit'|'metadata'|'replace'|'none'|'missing';id?:string}
const fieldMap:Record<string,string>={link:'linkRole',folder:'parent_id'};
function metadataInput(metadata:DocumentMetadata):Record<string,unknown>{return Object.fromEntries(metadataFields.filter(key=>metadata[key]!==undefined).map(key=>[fieldMap[key]??key,metadata[key]]));}
export async function planPush(workspace:Workspace,paths?:string[],options:PushOptions={}):Promise<PushPlan[]>{
 const validation=await validateFiles(workspace,paths,false,{skipMissingTracked:true});if(!validation.valid)throw new CliError('validation_failed','Local validation failed.','Run afbin validate and correct the reported errors.',validation);
 const conflicts=await readConflicts(workspace.home,workspace.root);
 const plans:PushPlan[]=[];
 for(const file of await inspectWorkspace(workspace,paths)){
  await checkRetiredCreate(workspace.home,workspace.root,file.path,file.document?.metadata.id??file.tracked?.id);
  if(!file.bytes&&file.tracked){plans.push({file,dependencies:[],ids:{},body:{},mode:'missing',id:file.tracked.id});continue;}
  if(!file.bytes)throw new CliError('missing_file',`Missing ${file.path}.`);
  const dependencies=file.document?await planDependencies(file.document.body,file.path,workspace.root):[];
  // Every asset enters publication as its placeholder; the server's hash preflight decides reuse.
  const ids:Record<string,string>={};
  for(const dependency of dependencies)ids[dependency.path]=dependency.id;
  const source=file.document?substituteDependencies(file.document.body,dependencies,ids):undefined;
  const resourceSource=file.resource?await readResourceSource(file.resource,file.path,workspace.root):undefined;
  const resource=file.resource;
  const resourceSettings=resource?{...metadataInput(resource),...(resource.type==='dataset'&&resource.access!==undefined?{access:resource.access}:{})}:undefined;
  const policyChanged=resource?.type==='dataset'&&resource.policy!==undefined&&!isDeepStrictEqual(resource.policy,file.tracked?.snapshot.dataset_policy??null);
  if(policyChanged&&!file.tracked)throw new CliError('combined_policy_write','Policy changes require an existing tracked dataset; creation and policy were both refused.','Publish the dataset first, pull its YAML settings, then set its policy.');
  const input=file.document?{...metadataInput(file.document.metadata),markup:source}:resource?{...resourceSettings,...await resourceContent(resource,file.path,workspace.root,resourceSource)}:assetInput(file.path,file.bytes);
  const id=file.document?.metadata.id??resource?.id??file.tracked?.id;
  if(id&&conflicts[id]&&!options.force)throw new CliError('merge_conflict',`${file.path} has an unresolved conflict.`,'Run afbin status to see it. Resolve locally and push --force, or pull --force to accept remote content.',conflicts[id],3);
  if(!id){plans.push({file,source:resourceSource,dependencies,ids,body:input,mode:'create'});continue;}
  if(!file.tracked){plans.push({file,dependencies,ids,body:{...input,...(file.document?.metadata.head_version!==undefined?{expectedVersion:file.document.metadata.head_version}:{}),...(file.document?.metadata.state?{expectedState:file.document.metadata.state}:{})},mode:'replace',id});continue;}
  const base=file.tracked.snapshot;
  const metadata=file.document?.metadata??resource;
  const oldMetadata=snapshotDocument(base).metadata;
  const delta:Record<string,unknown>=metadata?Object.fromEntries(metadataFields.filter(key=>metadata[key]!==undefined&&!isDeepStrictEqual(metadata[key],oldMetadata[key])).map(key=>[fieldMap[key]??key,metadata[key]])):{};
  if(resource?.type==='dataset'&&resource.access!==undefined&&resource.access!==base.access)delta.access=resource.access;
  if(policyChanged&&resource?.type==='dataset'){
   if(resource.policy_revision===undefined)throw new CliError('policy_revision_required','The YAML policy requires its observed policy_revision.','Pull the dataset YAML before changing its policy.');
   delta.policy=resource.policy;delta.expectedPolicyRevision=resource.policy_revision;
  }
  const changedBody=file.document?canonicalizeMarkup(source!)!==base.markup:resource?!!resourceSource&&resourceSource.bytes!==file.tracked.source?.bytes:digest(file.bytes)!==file.tracked.file;
  const historical=metadata?.version!==undefined;
  const mode=options.force||historical?'replace':!changedBody&&!Object.keys(delta).length?'none':changedBody&&file.document&&!Object.keys(delta).length?'edit':!changedBody?'metadata':'replace';
  if(policyChanged&&mode!=='metadata')throw new CliError('combined_policy_write','Content replacement and policy changes were both refused.','Publish content and pull its current state before making the policy-only change. Metadata and sharing can accompany the policy.');
  const body=mode==='edit'?{source,edit_id:metadata?.edit_id??base.edit_id}:mode==='metadata'?{...delta,expectedState:metadata?.state??base.state}: {...input,expectedState:metadata?.state??base.state,expectedVersion:metadata?.head_version??base.version};
  plans.push({file,source:resourceSource,dependencies,ids,body,mode,id,reconcile:!options.force&&!historical&&!!(file.document||resource)&&(mode==='replace'||mode==='metadata')});
 }
 // Selected documents own publication of their local dependencies. A bare push
 // must not also replace those assets in place and change existing readers.
 const composedPaths=new Set(plans.flatMap(plan=>plan.dependencies.map(dependency=>dependency.path)));
 return plans.filter(plan=>!composedPaths.has(plan.file.path));
}
/** Accept the local bytes as the tracked ones: a hash moves, nothing is written to disk. */
async function acknowledgeLocal(workspace:Workspace,plan:PushPlan):Promise<void>{
 if(!workspace.tracking||!plan.file.tracked||!plan.file.bytes)return;
 await saveTracking(workspace,{server:workspace.tracking.server,account:workspace.tracking.account,
  set:{[plan.file.path]:{...plan.file.tracked,file:digest(plan.file.bytes)}},
  ...(plan.file.renamedFrom?{remove:[plan.file.renamedFrom]}:{})});
}
const localChanged=(plan:PushPlan)=>plan.mode!=='missing'&&(!!plan.file.renamedFrom||!!plan.file.bytes&&digest(plan.file.bytes)!==plan.file.tracked?.file);
export async function finishLocalPush(workspace:Workspace,paths:string[],force=false):Promise<{operations:Array<Record<string,unknown>>}|null>{
 const plans=await planPush(workspace,paths,{force});
 if(plans.some(plan=>plan.mode!=='none'&&plan.mode!=='missing'))return null;
 if(!plans.some(localChanged))return{operations:plans.map(plan=>({path:plan.file.path,status:'skipped',reason:plan.mode==='missing'?'missing_file':'no_local_changes'}))};
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const refreshed=await planPush(workspace,paths,{force});if(refreshed.some(plan=>plan.mode!=='none'&&plan.mode!=='missing'))return null;
  const operations=[];
  for(const plan of refreshed){
   if(localChanged(plan)){await acknowledgeLocal(workspace,plan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}
   operations.push({path:plan.file.path,status:plan.file.renamedFrom?'renamed':'skipped',reason:plan.mode==='missing'?'missing_file':'no_remote_changes'});
  }
  return{operations};
 });
}
async function observeConditions(plan:PushPlan,client:HttpClient,force:boolean):Promise<PushPlan>{
 if(!plan.id||!force&&(plan.file.tracked||plan.body.expectedVersion!==undefined&&plan.body.expectedState!==undefined))return plan;
 const head=await client.request<Snapshot>(`/artifacts/${plan.id}`);
 if(!force&&(plan.body.expectedVersion!==undefined&&plan.body.expectedVersion!==head.version||plan.body.expectedState!==undefined&&plan.body.expectedState!==head.state))throw new CliError('state_conflict','The remote artifact differs from the state recorded in this file.','Inspect afbin diff --remote before deciding how to reconcile the changes.',{head},3);
 return{...plan,mode:'replace',body:{...plan.body,expectedVersion:head.version,expectedState:head.state}};
}
/** Mixed edits reconcile with the shared node kernel before a conditional atomic replacement. */
async function reconcileMixed(plan:PushPlan,client:HttpClient,workspace?:Workspace):Promise<PushPlan>{
 if(!plan.reconcile||!plan.file.tracked)return plan;
 const head=await client.request<Snapshot>(`/artifacts/${plan.id}`);
 if(plan.file.resource){
  const base=plan.file.tracked.snapshot,local=plan.file.resource;
  if(head.id!==plan.id||head.format!==base.format||typeof head.state!=='string'||!Number.isSafeInteger(head.version))throw new CliError('invalid_response','Resource reconciliation requires a complete snapshot of the same type.');
  const previous=snapshotResource(base,local),remote=snapshotResource(head,local);
  const merged=reconcileResource(previous,local,remote);
  const fields=!merged.ok?merged.fields:plan.mode==='replace'&&head.version!==(plan.file.tracked.source?.version??base.version)?['source']:[];
  if(fields.length){const error=new CliError('merge_conflict','Local and remote resource changes overlap.',undefined,{fields,base:writeResourceFile(previous),local:writeResourceFile(local),remote:writeResourceFile(remote),head},3);throw workspace?await persistConflict(workspace.home,workspace.root,plan.id!,plan.file.path,error):error;}
  if(!merged.ok)return plan;
  const desired={...metadataInput(merged.resource),...(merged.resource.type==='dataset'&&merged.resource.access!==undefined?{access:merged.resource.access}:{})};
  const observed={...metadataInput(remote),...(remote.type==='dataset'&&remote.access!==undefined?{access:remote.access}:{})};
  const delta:Record<string,unknown>=Object.fromEntries(Object.entries(desired).filter(([key,value])=>!isDeepStrictEqual(value,observed[key as keyof typeof observed])));
  if(merged.resource.type==='dataset'&&remote.type==='dataset'&&!isDeepStrictEqual(merged.resource.policy,remote.policy)){delta.policy=merged.resource.policy;delta.expectedPolicyRevision=remote.policy_revision;}
  if(plan.mode==='metadata')return Object.keys(delta).length?{...plan,body:{...delta,expectedState:head.state}}:{...plan,confirmed:head};
  const content=Object.fromEntries(Object.entries(plan.body).filter(([key])=>!['expectedState','expectedVersion','access','policy','expectedPolicyRevision',...metadataFields.map(field=>fieldMap[field]??field)].includes(key)));
  return {...plan,body:{...content,...delta,expectedState:head.state,expectedVersion:head.version}};
 }
 if(!plan.file.document)return plan;
 if(head.id!==plan.id||typeof head.markup!=='string'||typeof head.state!=='string'||!Number.isSafeInteger(head.version))throw new CliError('invalid_response','Reconciliation requires a complete remote snapshot.');
 const local={...plan.file.document,body:substituteDependencies(plan.file.document.body,plan.dependencies,plan.ids)};
 const result=reconcileDocument(snapshotDocument(plan.file.tracked.snapshot),local,snapshotDocument(head));
 if(!result.ok){
  const error=new CliError('merge_conflict','Local and remote changes overlap.','Preserve both proposals and resolve the reported fields before publishing.',{path:plan.file.path,fields:result.fields,base:writeDocument(snapshotDocument(plan.file.tracked.snapshot)),local:writeDocument(local),remote:writeDocument(snapshotDocument(head)),head},3);
  throw workspace?await persistConflict(workspace.home,workspace.root,plan.id!,plan.file.path,error):error;
 }
 const observed=metadataInput(snapshotDocument(head).metadata);
 const delta=Object.fromEntries(Object.entries(metadataInput(result.document.metadata)).filter(([key,value])=>!isDeepStrictEqual(value,observed[key])));
 return {...plan,body:{...delta,...(plan.mode==='replace'?{markup:result.document.body,expectedVersion:head.version}:{}),expectedState:head.state}};
}
export async function push(workspace:Workspace,paths:string[],client:HttpClient,options:PushOptions={}){
 if(options.dryRun){
  if(await readPendingRequest(workspace.home,workspace.root))throw new CliError('pending_recovery','Recover the pending request before dry-run.');
  const plans=await planPush(workspace,paths,options);const results=[];
  for(let plan of plans){
   if(plan.mode==='missing'){results.push({path:plan.file.path,status:'skipped',reason:'missing_file'});continue;}
   plan=await observeConditions(plan,client,!!options.force);
   plan=await reconcileMixed(plan,client);
   const mode=plan.mode==='none'?'replace':plan.mode;
   const input=plan.body;
   const preflight=await client.request<Record<string,unknown>>('/artifacts/preflight','POST',{...(plan.id?{id:plan.id}:{}),...(mode!=='create'?{mode}:{}),input,dependencies:plan.dependencies.map(d=>d.format==='dataset'?{id:plan.ids[d.path],input:d.input}:{id:plan.ids[d.path],sha256:d.sha256,size:d.size,filename:d.filename})});
   const reusable=new Map(((preflight.dependencies as PreflightDependencyResult[]|undefined)??[]).map(result=>[result.id,result.existing]));
   results.push({path:plan.file.path,...preflight,...(plan.dependencies.length?{dependencies:plan.dependencies.map(d=>{const reused=reusable.get(plan.ids[d.path]);return{path:d.path,id:d.id,...(reused?{would_reuse:reused}:{would_upload:true})};})}:{})});
  }
  return{dry_run:true,operations:results};
 }
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const pending=await readPendingRequest(workspace.home,workspace.root);
  const operations:Array<Record<string,unknown>>=[];
  if(pending){await recoverRequest(workspace,client,pending,true);operations.push({path:pending.file.path,status:'recovered'});workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  try{
  const plans=await planPush(workspace,paths,options);
  for(let plan of plans){
   if(plan.mode==='missing'){operations.push({path:plan.file.path,status:'skipped',reason:'missing_file'});continue;}
   if(plan.mode==='none'){if(localChanged(plan)){await acknowledgeLocal(workspace,plan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}operations.push({path:plan.file.path,status:plan.file.renamedFrom?'renamed':'skipped',reason:'no_remote_changes'});continue;}
   plan=await observeConditions(plan,client,!!options.force);
   if(plan.dependencies.length&&plan.mode!=='metadata'){
    const source=substituteDependencies(plan.file.document!.body,plan.dependencies,plan.ids);
    plan.body={...plan.body,...(plan.mode==='edit'?{source}:{markup:source})};
   }
   // One preflight per document decides, by hash, which assets the account already owns.
   if(plan.dependencies.length&&plan.mode!=='metadata'){
    plan=await reconcileMixed(plan,client,workspace);
    const preflight=await client.request<Record<string,unknown>>('/artifacts/preflight','POST',{...(plan.id?{id:plan.id}:{}),...(plan.mode!=='create'?{mode:plan.mode}:{}),input:plan.body,dependencies:plan.dependencies.map(d=>d.format==='dataset'?{id:plan.ids[d.path],input:d.input}:{id:plan.ids[d.path],sha256:d.sha256,size:d.size,filename:d.filename})});
    const reusable=new Map(((preflight.dependencies as PreflightDependencyResult[]|undefined)??[]).map(result=>[result.id,result.existing]));
    for(const dependency of plan.dependencies){
     const reused=reusable.get(plan.ids[dependency.path]);
     if(reused){plan.ids[dependency.path]=reused;operations.push({path:dependency.path,status:'reused',id:reused});continue;}
     await checkRetiredCreate(workspace.home,workspace.root,dependency.path);
     const bytes=dependency.bytes;
     const staged=await stageRequest(workspace.home,workspace.root,{server:client.connection.server,account:client.account,credential:digest(client.connection.token),request:{path:'/artifacts',method:'POST',body:dependency.input},file:{path:dependency.path,bytes:bytes.toString('base64')}});
     const snapshot=await recoverRequest(workspace,client,staged);plan.ids[dependency.path]=snapshot.id;operations.push({path:dependency.path,status:'published',id:snapshot.id});workspace=await loadWorkspace(workspace.cwd,workspace.home);
    }
   }
   if(plan.dependencies.length&&plan.mode!=='metadata'){
    const source=substituteDependencies(plan.file.document!.body,plan.dependencies,plan.ids);
    plan.body={...plan.body,...(plan.mode==='edit'?{source}:{markup:source})};
   }
   plan=await reconcileMixed(plan,client,workspace);
   const method=plan.mode==='metadata'?'PATCH':plan.mode==='replace'?'PUT':'POST';
   const path=plan.mode==='create'?'/artifacts':`/artifacts/${plan.id}${plan.mode==='edit'?'/edits':''}`;
   const mappings=Object.fromEntries(plan.dependencies.map(d=>[plan.ids[d.path],d.authored]));
   let staged=await stageRequest(workspace.home,workspace.root,{server:client.connection.server,account:client.account,credential:digest(client.connection.token),request:{path,method,body:plan.body},file:{source:plan.source,path:plan.file.path,bytes:plan.file.bytes!.toString('base64'),tracked:plan.file.tracked,renamedFrom:plan.file.renamedFrom,paths:mappings}});
   if(plan.confirmed)staged=await savePendingResponse(workspace.home,workspace.root,staged,plan.confirmed,client.account);
   const snapshot=await recoverRequest(workspace,client,staged);operations.push({path:plan.file.path,status:'published',id:snapshot.id,version:snapshot.version,...(snapshot.affected_dependents?{affected_dependents:snapshot.affected_dependents}:{})});workspace=await loadWorkspace(workspace.cwd,workspace.home);
  }
  return{operations};
  }catch(error){
   if(error instanceof CliError&&operations.length)throw new CliError(error.code,error.message,error.fix,{...(error.details&&typeof error.details==='object'&&!Array.isArray(error.details)?error.details:{}),completed_operations:operations},error.exitCode);
   throw error;
  }
 });
}
async function recoverRequest(workspace:Workspace,client:HttpClient,pending:PendingRequest,replaying=false):Promise<Snapshot>{
 if(pending.server!==client.connection.server||pending.account&&client.account&&pending.account!==client.account)throw new CliError('account_mismatch','Pending recovery belongs to another server or account.');
 if(!pending.account&&pending.credential!==digest(client.connection.token))throw new CliError('recovery_credentials_changed','Restore the credentials that initiated this pending create before retrying.');
 if(replaying&&!pending.response&&pending.request.path!=='/artifacts'){
  const id=pending.file.tracked?.id??parseDocument(Buffer.from(pending.file.bytes,'base64').toString()).metadata.id;
  if(!id)throw new CliError('outcome_unknown','Cannot identify the artifact for conditional-write recovery.');
  const head=await client.request<Snapshot>(`/artifacts/${id}`);
  const source=pending.request.body.source??pending.request.body.markup;
  const editable=new Set([...metadataFields.map(key=>fieldMap[key]??key),'access','policy']);
  const metadataMatches=Object.entries(pending.request.body).filter(([key])=>editable.has(key)).every(([key,value])=>isDeepStrictEqual(head[key==='linkRole'?'link_role':key==='policy'?'dataset_policy':key],value));
  const contentMatches=typeof source==='string'?canonicalizeMarkup(source)===head.markup:pending.request.method==='PATCH';
  if(contentMatches&&metadataMatches){pending=await savePendingResponse(workspace.home,workspace.root,pending,head,client.account);}
  else if(head.state!==pending.file.tracked?.snapshot.state)throw new CliError('outcome_unknown','The remote head changed after the unconfirmed write; automatic replay would be ambiguous.','Inspect afbin diff --remote and preserve both writers before resolving this pending operation.',{head,pending_key:pending.key});
 }
 if(!pending.response){
  let response:Record<string,unknown>;
  try{response=await client.request(pending.request.path,pending.request.method,pending.request.body,{'Idempotency-Key':pending.key});}
  catch(error){
   // Explicit refusal confirms no write; a transport failure must retain immutable replay state.
   const status=error instanceof CliError?(error.details as {http_status?:number}|undefined)?.http_status:undefined;
   if(error instanceof CliError&&error.code==='result_deleted'&&pending.request.path==='/artifacts'&&typeof (error.details as {id?:unknown})?.id==='string')await retireDeletedCreate(workspace.home,workspace.root,pending,(error.details as {id:string}).id);
   if(status&&status>=400&&status<500&&error instanceof CliError&&!['auth_required','result_deleted','idempotency_mismatch'].includes(error.code))await clearPendingRequest(workspace.home,workspace.root);
   if(error instanceof CliError&&['doc_changed','stale_edit_id','version_conflict','state_conflict'].includes(error.code))throw await describeConflict(error,pending,client,workspace.home,workspace.root);
   throw error;
  }
  if(response.response_expired===true&&typeof response.id==='string')response=await client.request(`/artifacts/${response.id}`);
  pending=await savePendingResponse(workspace.home,workspace.root,pending,response,client.account);
 }
 return acknowledgeSavedResponse(workspace,pending,client.account);
}
async function acknowledgeSavedResponse(workspace:Workspace,pending:PendingRequest,fallbackAccount?:string):Promise<Snapshot>{
 const account=pending.responseAccount??fallbackAccount;
 if(workspace.tracking&&(workspace.tracking.server!==pending.server||workspace.tracking.account!==account))throw new CliError('account_mismatch','Saved recovery belongs to another server or account.');
 const snapshot=readSnapshot(pending.response!,pending);
 const current=await readOptional(await confinedPath(workspace.root,pending.file.path));
 if(!current)throw new CliError('local_changed',`Remote publication succeeded, but ${pending.file.path} was removed. Recovery was retained.`,'Restore the local file and rerun afbin push.');
 let accepted=Buffer.from(pending.file.bytes,'base64');let written=current;
 if(extname(pending.file.path).toLowerCase()==='.jsx'){
  const frozen=parseDocument(accepted.toString());const latest=parseDocument(current.toString());
  if(latest.metadata.id&&latest.metadata.id!==snapshot.id||frozen.metadata.id&&!latest.metadata.id)throw new CliError('identity_mismatch','Local identity changed while the request was in flight. The server response is retained for recovery.');
  const restored=await restoreDependencyPaths(snapshot.markup??'',pending.file.paths??{},pending.file.path,workspace.root);
  const canonical=snapshotDocument(snapshot);canonical.body=restored;
  accepted=Buffer.from(writeDocument(canonical));
  if(digest(current)===digest(Buffer.from(pending.file.bytes,'base64')))written=accepted;
  else{
   // A create can add persistent IDs while the author keeps typing. Only
   // discount that normalization when the shared stamper reproduces the
   // entire confirmed source; a changed remote proposal still must merge.
   const normalizedCreate=pending.request.path==='/artifacts'&&canonicalizeMarkup(stampNodeIds(frozen.body,{previousSource:canonical.body}).source)===canonicalizeMarkup(canonical.body);
   const merged=reconcileDocument(frozen,latest,normalizedCreate?{...canonical,body:frozen.body}:canonical);
   if(!merged.ok)throw await persistConflict(workspace.home,workspace.root,snapshot.id,pending.file.path,new CliError('merge_conflict',`${pending.file.path} changed in overlapping regions while publication completed.`,'The confirmed response and local proposal are retained.',{fields:merged.fields,base:writeDocument(frozen),local:writeDocument(latest),remote:writeDocument(canonical),head:snapshot},3));
   written=Buffer.from(writeDocument(merged.document));
  }
 }
 if(['.yaml','.yml'].includes(extname(pending.file.path).toLowerCase())){
  const frozen=parseResourceFile(Buffer.from(pending.file.bytes,'base64').toString());
  const canonical=snapshotResource(snapshot,frozen);
  accepted=Buffer.from(writeResourceFile(canonical));
  if(current.equals(Buffer.from(pending.file.bytes,'base64')))written=accepted;
  else{
   const latest=parseResourceFile(current.toString());
   if(latest.id&&latest.id!==snapshot.id||frozen.id&&!latest.id)throw new CliError('identity_mismatch','Local resource identity changed while publication completed.');
   const merged=reconcileResource(frozen,latest,canonical);
   if(!merged.ok)throw await persistConflict(workspace.home,workspace.root,snapshot.id,pending.file.path,new CliError('merge_conflict','The resource changed in overlapping fields during publication.',undefined,{fields:merged.fields,base:writeResourceFile(frozen),local:current.toString(),remote:accepted.toString(),head:snapshot},3));
   written=Buffer.from(writeResourceFile(merged.resource));
  }
 }
 if(!account)throw new CliError('unsupported_server','The server did not return the current account identity.','Update the server before using workspace sync.');
 const source=pending.file.source?{...pending.file.source,version:pending.request.method==='PATCH'?(pending.file.tracked?.source?.version??pending.file.tracked?.snapshot.version):snapshot.version}:undefined;
 const entry:TrackedFile={source,id:snapshot.id,url:typeof snapshot.url==='string'?snapshot.url:`${pending.server}/a/${snapshot.id}`,file:digest(accepted),snapshot,paths:pending.file.paths};
 await stageFiles(workspace.home,workspace.root,[{path:pending.file.path,before:digest(current),data:written}],state=>writeTracking(state,workspace.root,{server:pending.server,account,set:{[pending.file.path]:entry},...(pending.file.renamedFrom?{remove:[pending.file.renamedFrom]}:{})}));
 await recoverFiles(workspace.home,workspace.root);await clearConflict(workspace.home,workspace.root,snapshot.id);await clearPendingRequest(workspace.home,workspace.root);return snapshot;
}
function readSnapshot(response:Record<string,unknown>,pending:PendingRequest):Snapshot{
 const previous=pending.file.tracked?.snapshot;
 const result={...previous,...response};
 if(typeof result.id!=='string'||!Number.isSafeInteger(result.version)||Number(result.version)<1||typeof result.edit_id!=='string'||typeof result.state!=='string'||!/^[a-f0-9]{64}$/.test(result.state))throw new CliError('invalid_response','The write response is incomplete; recovery is retained.');
 if(response.markup_changed===false){const source=pending.request.body.markup??pending.request.body.source??previous?.markup;if(typeof source==='string')result.markup=source;}
 if(extname(pending.file.path).toLowerCase()==='.jsx'&&typeof result.markup!=='string')throw new CliError('invalid_response','The canonical source is missing; recovery is retained.');
 return result as Snapshot;
}

/** Persist a confirmed response using only its checksummed journal. */
export async function finishSavedRequest(workspace:Workspace,server?:string):Promise<string|undefined>{
 const initial=await readPendingRequest(workspace.home,workspace.root);if(!initial?.response)return;
 if(server&&server!==initial.server)throw new CliError('account_mismatch','Saved recovery belongs to another server.');
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const pending=await readPendingRequest(workspace.home,workspace.root);if(!pending?.response)return;
  await acknowledgeSavedResponse(workspace,pending);return pending.file.path;
 });
}
