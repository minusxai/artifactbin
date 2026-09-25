import {createDocumentGraph} from '../../app/lib/story/document-graph';
import {documentOutcomePresent} from './document-recovery';
import {prepareClientDocumentPublication} from '../../app/lib/story/document-update-client';
import type {DocumentGraph,DocumentUpdate,DocumentAssetWarning} from '@artifactbin/contracts';
import {localIdentities} from './identities';
import {referenceIds} from './preview/graph';
import {inferColumns} from '@artifactbin/utils/shape';
import {viewersWritePolicy} from '../../utils/src/dataset-policy';
import type {DatasetAccessPolicy as DatasetPolicy} from '@artifactbin/contracts';
import {readConflicts,persistConflict,clearConflict} from './conflict-state';
import {isDeepStrictEqual} from 'node:util';
import {extname,resolve} from 'node:path';
import {canonicalizeMarkup} from '../../app/lib/story/canonical-source';
import {parseDatasetDefinition} from '../../app/lib/datasets/definition';
import {stampNodeIds} from '../../app/lib/story/node-ids';
import {CliError} from './commands';
import {digest,readOptional} from './files';
import {confinedPath,recoverFiles,stageFiles} from './journal';
import {withLock} from './state';
import {parseDocument,writeDocument,metadataFields,type DocumentMetadata} from './document';
import {snapshotDocument} from './local';
import {loadWorkspace,inspectWorkspace,saveTracking,writeTracking,type Workspace,type LocalFile,type Snapshot,type TrackedFile} from './workspace';
import {assetInput} from './upload-input';
import {validateFiles} from './validation';
import {checkRetiredCreate,retireDeletedCreate,stageRequest,readPendingRequest,savePendingResponse,clearPendingRequest,type PendingRequest} from './pending-request';
import {HttpClient} from './http';
import {describeConflict} from './conflict';
import {reconcileDocument} from './reconcile';
import {datasetFileRows,isDatasetFile} from './dataset-file';
import {parseResourceFile,readResourceSource,reconcileResource,resourceContent,snapshotResource,writeResourceFile,type ResourceSource} from './resource-file';
/**
 * `access` is the pushed dataset's row access — the CLI door to a dataset a document may WRITE to —
 * and `policy` is who may write it: `viewers-write` grants everyone with view access the row writes a
 * page's buttons make. The server refuses a policy on a content write, so a policy a create needs
 * rides a second request inside the same command (`plan.policy`), never a second command.
 */
interface PushOptions {force?:boolean;dryRun?:boolean;access?:'read'|'readwrite';policy?:'viewers-write'|'none'}
interface PushPlan {warnings?:DocumentAssetWarning[];authoringBase?:Snapshot;confirmed?:Snapshot;source?:ResourceSource;reconcile?:boolean;file:LocalFile;body:Record<string,unknown>;mode:'create'|'edit'|'metadata'|'replace'|'none'|'missing';id?:string;policy?:DatasetPolicy|null;policyName?:string}
const fieldMap:Record<string,string>={link:'linkRole',folder:'parent_id'};
/**
 * The tables `--policy viewers-write` is aimed at: the ones the pushed `<Dataset>` definition
 * DECLARES, so the grant fits the dataset instead of always naming `public.rows`. A CSV/JSON push
 * has no definition and keeps that single table, which is the one it exposes. A definition that does
 * not parse is not diagnosed here — local validation and the server both say so about the source
 * itself, and a second wording of the same fault is one more thing to learn.
 */
function declaredTables(source?:ResourceSource):Array<{schema:string;name:string}>|undefined{
 if(!source||extname(source.path).toLowerCase()!=='.jsx')return undefined;
 const text=Buffer.from(source.bytes,'base64').toString();
 if(!text.trimStart().startsWith('<Dataset'))return undefined;
 try{
  const tables=parseDatasetDefinition(text).tables.map(table=>({schema:table.schema,name:table.name}));
  return tables.length?tables:undefined;
 }catch{return undefined;}
}
function metadataInput(metadata:DocumentMetadata):Record<string,unknown>{return Object.fromEntries(metadataFields.filter(key=>metadata[key]!==undefined).map(key=>[fieldMap[key]??key,metadata[key]]));}
/** Compare body bytes, not metadata the CLI necessarily updates after publication. */
function sourceRewrite(snapshot:Snapshot,source:unknown):Record<string,unknown>{
 const rewritten=typeof source==='string'&&typeof snapshot.markup==='string'&&source!==snapshot.markup;
 return {...(rewritten?{source_rewritten:true,hint:'Your file was rewritten; re-read it before editing.'}:{}),...(Array.isArray(snapshot.source_repairs)&&snapshot.source_repairs.length?{source_repairs:snapshot.source_repairs}:{})};
}
export async function planPush(workspace:Workspace,paths?:string[],options:PushOptions={}):Promise<PushPlan[]>{
 const localIds=await localIdentities(workspace);
 const ordered:LocalFile[]=[],active=new Set<string>(),done=new Set<string>();
 const visit=async(file:LocalFile):Promise<void>=>{
  if(active.has(file.path))throw new CliError('dependency_cycle',`Cyclic document reference: ${file.path}.`,'Remove the cycle before publishing.');
  if(done.has(file.path))return;active.add(file.path);
  if(file.document)for(const id of referenceIds(file.document.body)){
   const path=localIds[id];
   if(path&&!active.has(path)&&!workspace.tracking?.files[path]){const [child]=await inspectWorkspace(workspace,[resolve(workspace.root,path)]);await visit(child);}
  }
  active.delete(file.path);done.add(file.path);ordered.push(file);
 };
 for(const file of await inspectWorkspace(workspace,paths))await visit(file);
 const validation=await validateFiles(workspace,ordered.map(file=>resolve(workspace.root,file.path)),false,{skipMissingTracked:true});if(!validation.valid)throw new CliError('validation_failed','Local validation failed.','Run afbin validate and correct the reported errors.',validation);
 const conflicts=await readConflicts(workspace.home,workspace.root);
 const plans:PushPlan[]=[];
 let accessible=false;
 for(const file of ordered){
  await checkRetiredCreate(workspace.home,workspace.root,file.path,file.document?.metadata.id??file.tracked?.id);
  if(!file.bytes&&file.tracked){plans.push({file,body:{},mode:'missing',id:file.tracked.id});continue;}
  if(!file.bytes)throw new CliError('missing_file',`Missing ${file.path}.`);
  const source=file.document?.body;
  const resourceSource=file.resource?await readResourceSource(file.resource,file.path,workspace.root):undefined;
  const resource=file.resource;
  // One access per pushed dataset: the YAML states it, --access states it for a bare CSV/JSON push,
  // and a disagreement is refused rather than silently resolved in either direction.
  const datasetFile=resource?resource.type==='dataset':!file.document&&isDatasetFile(file.path);
  // A viewers' write grant is meaningless on a read-only dataset, so the policy implies the access.
  const requestedAccess=options.access??(options.policy==='viewers-write'?'readwrite':undefined);
  if(options.access!==undefined||options.policy!==undefined){
   // A NAMED target that cannot take an access is a typo, not an instruction to ignore the flag; a bare
   // push aims it at the datasets among the tracked files, and refuses below if there are none.
   if(!datasetFile&&paths?.length)throw new CliError('unsupported_access',`--access and --policy set a dataset's row writes; ${file.path} is not a dataset.`,'Push the CSV or JSON rows with the flag, or drop it.');
   if(datasetFile)accessible=true;
   if(resource?.type==='dataset'&&resource.access!==undefined&&options.access!==undefined&&resource.access!==options.access)throw new CliError('access_mismatch',`--access ${options.access} disagrees with ${file.path}, which declares access: ${resource.access}.`,'Name the same access in both, or drop the flag and let the file decide.');
  }
  const access=datasetFile?(resource?.type==='dataset'?resource.access??requestedAccess:requestedAccess):undefined;
  // `undefined` means the flag said nothing; `null` is the flag asking for no policy at all.
  const flagPolicy=!datasetFile||options.policy===undefined?undefined:options.policy==='none'?null:viewersWritePolicy(declaredTables(resourceSource));
  if(flagPolicy!==undefined&&resource?.type==='dataset'&&resource.policy!==undefined&&!isDeepStrictEqual(resource.policy,flagPolicy))throw new CliError('policy_mismatch',`--policy ${options.policy} disagrees with the policy declared in ${file.path}.`,'Drop the flag to publish the file\'s own policy, or remove policy: from the YAML.');
  const flagPolicyChanged=flagPolicy!==undefined&&!isDeepStrictEqual(flagPolicy,file.tracked?.snapshot.dataset_policy??null);
  const deferrable=flagPolicyChanged?{policy:flagPolicy,policyName:String(options.policy)}:{};
  const resourceSettings=resource?{...metadataInput(resource),...(access!==undefined?{access}:{})}:undefined;
  const policyChanged=resource?.type==='dataset'&&resource.policy!==undefined&&!isDeepStrictEqual(resource.policy,file.tracked?.snapshot.dataset_policy??null);
  if(policyChanged&&!file.tracked)throw new CliError('combined_policy_write','Policy changes require an existing tracked dataset; creation and policy were both refused.','Publish the dataset first, pull its YAML settings, then set its policy.');
  const input=file.document?{...metadataInput(file.document.metadata),markup:source}:resource?{...resourceSettings,...await resourceContent(resource,file.path,workspace.root,resourceSource)}:{...assetInput(file.path,file.bytes),...(access!==undefined?{access}:{})};
  const registered=Object.entries(localIds).find(([,path])=>path===file.path)?.[0];
  const id=file.document?.metadata.id??resource?.id??file.tracked?.id??registered;
  if(id&&conflicts[id]&&!options.force)throw new CliError('merge_conflict',`${file.path} has an unresolved conflict.`,'Run afbin status to see it. Resolve locally and push --force, or pull --force to accept remote content.',conflicts[id],3);
  const draftIdentity=!!id&&!file.tracked&&(!!registered||!!file.document)&&!(file.document?.metadata??resource)?.head_version&&!(file.document?.metadata??resource)?.edit_id&&!(file.document?.metadata??resource)?.state;
  if(!id||draftIdentity){if(draftIdentity)Object.assign(input,{reserved_id:id});plans.push({file,source:resourceSource,body:input,mode:'create',...deferrable});continue;}
  if(!file.tracked){plans.push({file,body:{...input,...(file.document?.metadata.head_version!==undefined?{expectedVersion:file.document.metadata.head_version}:{}),...(file.document?.metadata.state?{expectedState:file.document.metadata.state}:{})},mode:'replace',id,...deferrable});continue;}
  const base=file.tracked.snapshot;
  const metadata=file.document?.metadata??resource;
  const oldMetadata=snapshotDocument(base).metadata;
  const delta:Record<string,unknown>=metadata?Object.fromEntries(metadataFields.filter(key=>metadata[key]!==undefined&&!isDeepStrictEqual(metadata[key],oldMetadata[key])).map(key=>[fieldMap[key]??key,metadata[key]])):{};
  if(access!==undefined&&access!==base.access)delta.access=access;
  // The tracked case reuses the metadata write the YAML path already uses: one PATCH, compare-and-swap
  // on the revision this workspace last observed, so no pull is needed first.
  if(flagPolicyChanged){delta.policy=flagPolicy;delta.expectedPolicyRevision=Number(base.policy_revision??0);}
  if(policyChanged&&resource?.type==='dataset'){
   if(resource.policy_revision===undefined)throw new CliError('policy_revision_required','The YAML policy requires its observed policy_revision.','Pull the dataset YAML before changing its policy.');
   delta.policy=resource.policy;delta.expectedPolicyRevision=resource.policy_revision;
  }
  const changedBody=file.document?canonicalizeMarkup(source!)!==base.markup:resource?!!resourceSource&&resourceSource.bytes!==file.tracked.source?.bytes:digest(file.bytes)!==file.tracked.file;
  const historical=metadata?.version!==undefined;
  const mode=options.force||historical?'replace':!changedBody&&!Object.keys(delta).length?'none':changedBody&&file.document&&!Object.keys(delta).length?'edit':!changedBody?'metadata':'replace';
  if(policyChanged&&mode!=='metadata')throw new CliError('combined_policy_write','Content replacement and policy changes were both refused.','Publish content and pull its current state before making the policy-only change. Metadata and sharing can accompany the policy.');
  // Content and policy cannot ride one request: a replacement publishes first, then the policy follows.
  if(flagPolicyChanged&&mode!=='metadata'){delete delta.policy;delete delta.expectedPolicyRevision;}
  const body=mode==='edit'?{source,edit_id:metadata?.edit_id??base.edit_id}:mode==='metadata'?{...delta,expectedState:metadata?.state??base.state}: {...input,expectedState:metadata?.state??base.state,expectedVersion:metadata?.head_version??base.version};
  plans.push({file,source:resourceSource,body,mode,id,...(flagPolicyChanged&&mode!=='metadata'?deferrable:flagPolicyChanged?{policyName:String(options.policy)}:{}),reconcile:!options.force&&!historical&&!!(file.document||resource)&&(mode==='replace'||mode==='metadata')});
 }
 if((options.access!==undefined||options.policy!==undefined)&&!accessible)throw new CliError('unsupported_access','--access and --policy set a dataset\'s row writes; no dataset was selected.','Name the CSV, JSON or dataset YAML to publish with the flag.');
 return plans;
}
/** A no-op publication acknowledges local hashes and renames. */
async function acknowledgeLocal(workspace:Workspace,plan:PushPlan):Promise<void>{
 if(!workspace.tracking||!plan.file.tracked||!plan.file.bytes)return;
 const data=plan.file.bytes;
 const tracking={server:workspace.tracking.server,account:workspace.tracking.account,
  set:{[plan.file.path]:{...plan.file.tracked,file:digest(data)}},
  ...(plan.file.renamedFrom?{remove:[plan.file.renamedFrom]}:{})};
 if(data.equals(plan.file.bytes)){await saveTracking(workspace,tracking);return;}
 await stageFiles(workspace.home,workspace.root,[{path:plan.file.path,before:digest(plan.file.bytes),data}],state=>writeTracking(state,workspace.root,tracking));
 await recoverFiles(workspace.home,workspace.root);
}
const localChanged=(plan:PushPlan)=>plan.mode!=='missing'&&(!!plan.file.renamedFrom||!!plan.file.bytes&&digest(plan.file.bytes)!==plan.file.tracked?.file);
export async function finishLocalPush(workspace:Workspace,paths:string[],options:PushOptions={}):Promise<{operations:Array<Record<string,unknown>>}|null>{
 const plans=await planPush(workspace,paths,options);
 if(plans.some(plan=>plan.mode!=='none'&&plan.mode!=='missing'))return null;
 if(!plans.some(localChanged))return{operations:plans.map(plan=>({path:plan.file.path,status:'skipped',reason:plan.mode==='missing'?'missing_file':'no_local_changes'}))};
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const refreshed=await planPush(workspace,paths,options);if(refreshed.some(plan=>plan.mode!=='none'&&plan.mode!=='missing'))return null;
  const operations=[];
  for(const plan of refreshed){
   if(localChanged(plan)){await acknowledgeLocal(workspace,plan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}
   operations.push({path:plan.file.path,status:plan.file.renamedFrom?'renamed':'skipped',reason:plan.mode==='missing'?'missing_file':'no_remote_changes'});
  }
  return{operations};
 });
}
/** Prepare the complete document mutation locally from its tracked graph. A
 * missing graph needs one read to upgrade the client's snapshot, not a server
 * read/validate/retry write pipeline. */
async function prepareDocumentPlan(plan:PushPlan,client:HttpClient,force:boolean,dryRun=false):Promise<PushPlan>{
 if(!plan.file.document||!plan.id||['create','missing','none'].includes(plan.mode))return plan;
 let head=plan.file.tracked?.snapshot;
 if(force||!head?.document)head=await client.request<Snapshot>(`/artifacts/${plan.id}`);
 const native=['dataset','viz','image','pdf','file'].includes(head.format??'');
 const document=(native?createDocumentGraph('',head.version):head.document) as DocumentGraph|undefined;
 if(document?.kind!=='graph')throw new CliError('invalid_response','The artifact has no editable JSONB snapshot.');
 if(!force&&!plan.file.tracked&&(plan.body.expectedVersion!==undefined&&plan.body.expectedVersion!==head.version||plan.body.expectedState!==undefined&&plan.body.expectedState!==head.state))throw new CliError('state_conflict','The remote artifact differs from the state recorded in this file.','Inspect afbin diff --remote before deciding how to reconcile the changes.',{head},3);
 const desired=metadataInput(plan.file.document.metadata),observed=metadataInput(snapshotDocument(head).metadata);
 const delta=Object.fromEntries(Object.entries(desired).filter(([k,v])=>!isDeepStrictEqual(v,observed[k])));
 const metadata=Object.fromEntries(Object.entries(delta).filter(([k])=>['title','description','theme','template','colorMode'].includes(k))) as DocumentUpdate['metadata'];
 const settings:NonNullable<DocumentUpdate['settings']>={
  ...(delta.visibility!==undefined?{visibility:delta.visibility as 'private'|'unlisted'|'public'}:{}),
  ...(delta.linkRole!==undefined?{linkRole:delta.linkRole as 'viewer'|'commenter'|'editor'}:{}),
  ...(delta.parent_id!==undefined?{parentId:delta.parent_id as string|null}:{}),
  ...(delta.shares!==undefined?{shares:delta.shares as NonNullable<DocumentUpdate['settings']>['shares']}:{}),
 };
 let warnings:DocumentAssetWarning[]=[];
 const update=await prepareClientDocumentPublication({document,version:head.version,title:head.title,description:head.description as string|null,meta:{theme:head.theme,template:head.template,colorMode:head.colorMode}},{source:plan.file.document.body,metadata,whole:native||force||plan.file.document.metadata.version!==undefined},async source=>client.request(`/artifacts/${plan.id}/prepare`,'POST',{source,dryRun}),received=>{warnings=received;});
 if(Object.keys(settings).length)Object.assign(update,{settings,expectedSharingRevision:Number(head.sharing_revision??0),expectedParentIds:head.ancestor_ids??[]});
 return {...plan,warnings,authoringBase:head,mode:'edit',reconcile:false,body:{edit_id:head.edit_id,document_update:update}};
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
 const local=plan.file.document;
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
   plan=await prepareDocumentPlan(plan,client,!!options.force,!!options.dryRun);
   if(!plan.body.document_update)plan=await observeConditions(plan,client,!!options.force);
   plan=await reconcileMixed(plan,client);
   const mode=plan.mode==='none'?'replace':plan.mode;
   const preflight=await client.request<Record<string,unknown>>('/artifacts/preflight','POST',{...(plan.id?{id:plan.id}:{}),...(mode!=='create'?{mode}:{}),input:plan.body});
   results.push({path:plan.file.path,...preflight,...(plan.warnings?.length?{asset_warnings:plan.warnings}:{})});
  }
  return{dry_run:true,operations:results};
 }
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const pending=await readPendingRequest(workspace.home,workspace.root);
  const operations:Array<Record<string,unknown>>=[];
  if(pending){const recovered=await recoverRequest(workspace,client,pending,true);operations.push({path:pending.file.path,status:'recovered',...(pending.file.warnings?.length?{asset_warnings:pending.file.warnings}:{}),...sourceRewrite(recovered,pending.request.body.markup??pending.request.body.source)});workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  try{
  const plans=await planPush(workspace,paths,options);
  for(let plan of plans){
   if(plan.mode==='missing'){operations.push({path:plan.file.path,status:'skipped',reason:'missing_file'});continue;}
   if(plan.mode==='none'){if(localChanged(plan)){await acknowledgeLocal(workspace,plan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}operations.push({path:plan.file.path,status:plan.file.renamedFrom?'renamed':'skipped',reason:'no_remote_changes'});continue;}
   plan=await prepareDocumentPlan(plan,client,!!options.force,!!options.dryRun);
   if(!plan.body.document_update)plan=await observeConditions(plan,client,!!options.force);
   plan=await reconcileMixed(plan,client,workspace);
   const method=plan.mode==='metadata'?'PATCH':plan.mode==='replace'?'PUT':'POST';
   const path=plan.mode==='create'?'/artifacts':`/artifacts/${plan.id}${plan.mode==='edit'?'/edits':''}`;
   let staged=await stageRequest(workspace.home,workspace.root,{server:client.connection.server,account:client.account,credential:digest(client.connection.token),request:{path,method,body:plan.body},file:{warnings:plan.warnings,authoringBase:plan.authoringBase,source:plan.source,path:plan.file.path,bytes:plan.file.bytes!.toString('base64'),tracked:plan.file.tracked,renamedFrom:plan.file.renamedFrom}});
   if(plan.confirmed)staged=await savePendingResponse(workspace.home,workspace.root,staged,plan.confirmed,client.account);
   const snapshot=await recoverRequest(workspace,client,staged);workspace=await loadWorkspace(workspace.cwd,workspace.home);
   const operation:Record<string,unknown>={path:plan.file.path,status:'published',...(plan.warnings?.length?{asset_warnings:plan.warnings}:{}),id:snapshot.id,version:snapshot.version,...sourceRewrite(snapshot,plan.file.document?.body),...(snapshot.affected_dependents?{affected_dependents:snapshot.affected_dependents}:{}),...datasetColumns(plan.file.path,plan.file.bytes),...datasetAccess(snapshot,plan.body)};
   operations.push(operation);
   // The policy the content write could not carry, on the published dataset, inside the same command.
   if(plan.policy!==undefined){await writeDatasetPolicy(workspace,client,plan,snapshot);workspace=await loadWorkspace(workspace.cwd,workspace.home);}
   if(plan.policyName)operation.policy=plan.policyName;
  }
  return{operations};
  }catch(error){
   if(error instanceof CliError&&operations.length)throw new CliError(error.code,error.message,error.fix,{...(error.details&&typeof error.details==='object'&&!Array.isArray(error.details)?error.details:{}),completed_operations:operations},error.exitCode);
   throw error;
  }
 });
}
async function recoverRequest(workspace:Workspace,client:HttpClient,pending:PendingRequest,replaying=false):Promise<Snapshot>{
 if(!client.sameServer(pending.server)||pending.account&&client.account&&pending.account!==client.account)throw new CliError('account_mismatch','Pending recovery belongs to another server or account.');
 if(!pending.account&&pending.credential!==digest(client.connection.token))throw new CliError('recovery_credentials_changed','Restore the credentials that initiated this pending create before retrying.');
 if(replaying&&!pending.response&&pending.request.path!=='/artifacts'){
  const id=pending.file.tracked?.id??parseDocument(Buffer.from(pending.file.bytes,'base64').toString()).metadata.id;
  if(!id)throw new CliError('outcome_unknown','Cannot identify the artifact for conditional-write recovery.');
  const head=await client.request<Snapshot>(`/artifacts/${id}`);
  const source=pending.request.body.source??pending.request.body.markup??(pending.request.body.document_update?parseDocument(Buffer.from(pending.file.bytes,'base64').toString()).body:undefined);
  const editable=new Set([...metadataFields.map(key=>fieldMap[key]??key),'access','policy']);
  const metadataMatches=Object.entries(pending.request.body.document_update?(pending.request.body.document_update as DocumentUpdate).metadata??{}:pending.request.body).filter(([key])=>editable.has(key)).every(([key,value])=>isDeepStrictEqual(head[key==='linkRole'?'link_role':key==='policy'?'dataset_policy':key],value));
  const contentMatches=pending.request.body.document_update?documentOutcomePresent(head,pending.file.authoringBase??pending.file.tracked?.snapshot,pending.request.body.document_update as DocumentUpdate):typeof source==='string'?canonicalizeMarkup(source)===head.markup:pending.request.method==='PATCH';
  if(contentMatches&&metadataMatches){pending=await savePendingResponse(workspace.home,workspace.root,pending,head,client.account);}
  else if(head.state!==(pending.file.authoringBase??pending.file.tracked?.snapshot)?.state)throw new CliError('outcome_unknown','The remote head changed after the unconfirmed write; automatic replay would be ambiguous.','Inspect afbin diff --remote and preserve both writers before resolving this pending operation.',{head,pending_key:pending.key});
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
 return acknowledgeSavedResponse(workspace,pending,client.account,[client.connection.server,...client.aliases]);
}
/** One server, several addresses: a record journaled under any verified address is this server's. */
const sameAddress=(one:string,other:string,addresses:readonly string[])=>one===other||(addresses.includes(one)&&addresses.includes(other));
async function acknowledgeSavedResponse(workspace:Workspace,pending:PendingRequest,fallbackAccount?:string,addresses:readonly string[]=[]):Promise<Snapshot>{
 const account=pending.responseAccount??fallbackAccount;
 if(workspace.tracking&&(!sameAddress(workspace.tracking.server,pending.server,addresses)||workspace.tracking.account!==account))throw new CliError('account_mismatch','Saved recovery belongs to another server or account.');
 const snapshot=readSnapshot(pending.response!,pending);
 const current=await readOptional(await confinedPath(workspace.root,pending.file.path));
 if(!current)throw new CliError('local_changed',`Remote publication succeeded, but ${pending.file.path} was removed. Recovery was retained.`,'Restore the local file and rerun afbin push.');
 let accepted=Buffer.from(pending.file.bytes,'base64');let written=current;
 if(extname(pending.file.path).toLowerCase()==='.jsx'){
  const frozen=parseDocument(accepted.toString());const latest=parseDocument(current.toString());
  if(latest.metadata.id&&latest.metadata.id!==snapshot.id||frozen.metadata.id&&!latest.metadata.id)throw new CliError('identity_mismatch','Local identity changed while the request was in flight. The server response is retained for recovery.');
  const canonical=snapshotDocument(snapshot);
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
 const entry:TrackedFile={source,id:snapshot.id,url:typeof snapshot.url==='string'?snapshot.url:`${pending.server}/a/${snapshot.id}`,file:digest(accepted),snapshot};
 await stageFiles(workspace.home,workspace.root,[{path:pending.file.path,before:digest(current),data:written}],state=>writeTracking(state,workspace.root,{server:pending.server,account,set:{[pending.file.path]:entry},...(pending.file.renamedFrom?{remove:[pending.file.renamedFrom]}:{})}));
 await recoverFiles(workspace.home,workspace.root);await clearConflict(workspace.home,workspace.root,snapshot.id);await clearPendingRequest(workspace.home,workspace.root);return snapshot;
}
function readSnapshot(response:Record<string,unknown>,pending:PendingRequest):Snapshot{
 const previous=pending.file.tracked?.snapshot;
 const result={...previous,...response};
 if(!Object.hasOwn(response,'source_repairs'))delete result.source_repairs;
 if(pending.request.body.reserved_id!==undefined&&result.id!==pending.request.body.reserved_id)throw new CliError('invalid_response','The server returned a different artifact identity; recovery is retained.');
 if(typeof result.id!=='string'||!Number.isSafeInteger(result.version)||Number(result.version)<1||typeof result.edit_id!=='string'||typeof result.state!=='string'||!/^[a-f0-9]{64}$/.test(result.state))throw new CliError('invalid_response','The write response is incomplete; recovery is retained.');
 if(response.markup_changed===false){const source=pending.request.body.markup??pending.request.body.source??previous?.markup;if(typeof source==='string')result.markup=source;}
 if(extname(pending.file.path).toLowerCase()==='.jsx'&&typeof result.markup!=='string')throw new CliError('invalid_response','The canonical source is missing; recovery is retained.');
 return result as Snapshot;
}

/** Persist a confirmed response using only its checksummed journal. */
export async function finishSavedRequest(workspace:Workspace,server?:string,addresses:readonly string[]=[]):Promise<{path:string;[key:string]:unknown}|undefined>{
 const initial=await readPendingRequest(workspace.home,workspace.root);if(!initial?.response)return;
 if(server&&!sameAddress(server,initial.server,addresses))throw new CliError('account_mismatch','Saved recovery belongs to another server.');
 return withLock(workspace.home,workspace.root,async()=>{
  await recoverFiles(workspace.home,workspace.root);workspace=await loadWorkspace(workspace.cwd,workspace.home);
  const pending=await readPendingRequest(workspace.home,workspace.root);if(!pending?.response)return;
  const snapshot=await acknowledgeSavedResponse(workspace,pending,undefined,addresses);return {path:pending.file.path,...sourceRewrite(snapshot,pending.request.body.markup??pending.request.body.source)};
 });
}

/**
 * The policy write the server refuses to combine with content: same command, same journal, one PATCH.
 *
 * A content write echoes a CURATED wire with no policy fields, so the revision to compare and swap on
 * cannot come from it. A create's is 0 by construction; for anything else the head is observed, which
 * also says whether the grant is already in place and no write is owed at all.
 */
async function writeDatasetPolicy(workspace:Workspace,client:HttpClient,plan:PushPlan,snapshot:Snapshot):Promise<Snapshot>{
 const observed=plan.mode==='create'?undefined:await client.request<Snapshot>(`/artifacts/${snapshot.id}`);
 if(observed&&isDeepStrictEqual(observed.dataset_policy??null,plan.policy??null))return snapshot;
 const staged=await stageRequest(workspace.home,workspace.root,{server:client.connection.server,account:client.account,credential:digest(client.connection.token),
  request:{path:`/artifacts/${snapshot.id}`,method:'PATCH',body:{policy:plan.policy,expectedPolicyRevision:Number(observed?.policy_revision??snapshot.policy_revision??0),expectedState:typeof observed?.state==='string'?observed.state:snapshot.state}},
  file:{warnings:plan.warnings,authoringBase:plan.authoringBase,source:plan.source,path:plan.file.path,bytes:plan.file.bytes!.toString('base64'),tracked:workspace.tracking?.files[plan.file.path]}});
 return recoverRequest(workspace,client,staged);
}
/**
 * Beside those columns: whether a document may WRITE to what was just published. An agent that
 * pushed rows for a `<Mutation>` reads its answer here instead of discovering it at publish.
 */
function datasetAccess(snapshot:Snapshot,body:Record<string,unknown>):{access?:string}{
 const access=typeof snapshot.access==='string'?snapshot.access:typeof body.access==='string'?body.access:undefined;
 return access!==undefined&&(snapshot.format==='dataset'||typeof body.access==='string')?{access}:{};
}
/**
 * A published CSV or JSON dataset names its columns and types in the reply, so the agent writes SQL
 * against them instead of probing: pi spent eight model calls learning that `month` was a string
 * (local hardcore report, 14 Sep). Inferred locally from the bytes it just pushed; never a server call.
 */
function datasetColumns(path:string,bytes:Buffer|null):{columns?:Array<{name:string;type:string}>}{
 if(!bytes)return{};
 try{
  if(!isDatasetFile(path))return{};
  return{columns:inferColumns(datasetFileRows(path,bytes)).map(c=>({name:c.name,type:c.type}))};
 }catch{return{};}
}
