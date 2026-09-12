import {join,relative,resolve} from 'node:path';
import {readdir,stat} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {stringify} from 'yaml';
import {createTwoFilesPatch} from 'diff';
import {parseAccountResource} from '@artifactbin/utils/account-resource';
import {ACCOUNT_RESOURCE_TYPES,type AccountResource,type ProfileResource,type SessionResource} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {parseLiteralYaml} from './document';
import {digest,localBackup,readOptional} from './files';
import {confinedPath,stageFiles,recoverFiles,type FileChange} from './journal';
import {withLock,type State} from './state';
import {readState,stateFor} from './state-access';
import {recoverableOperation} from './recoverable-operation';
import {readConflicts} from './conflict-state';
import {deleteResources} from './delete';
import {pushRefresh,pushRestore} from './restore';
import {listSessions,parseSessionResource,readSession,sessionFileName,sessionIdentity} from './sessions';
import {localDiff} from './local';
import {pull} from './pull';
import {finishLocalPush,push} from './sync';
import {validateFiles} from './validation';
import {inspectWorkspace,type LocalFile,type Workspace} from './workspace';
import type {HttpClient} from './http';
/** What the store keeps for one tracked account resource: its accepted settings and the sha256 of the YAML those settings render to. */
interface Entry {resource:AccountResource;sha256:string}
/** The store's picture of this workspace: the `workspace` binding plus every `account` record under that root. */
interface Tracking {server:string;account:string;files:Record<string,Entry>}
/**
 * One plan says which invocations this module owns. `resource` covers the
 * account resources tracked as `account` records in the state store and, when a
 * workspace holds both families, the artifact files that accompany them;
 * `restore`, `refresh` and `delete` are remote rows whose targets are ids.
 */
interface AccountPlan {kind:'resource'|'restore'|'refresh'|'delete';paths:string[];artifacts:string[];manifest:Tracking|null}
const yaml=(value:unknown)=>stringify(value,{lineWidth:0});
const accountResource=(value:unknown):AccountResource=>(value as {type?:unknown})?.type==='session'?parseSessionResource(value):parseAccountResource(value);
const parse=(bytes:Buffer)=>{try{return accountResource(parseLiteralYaml(bytes.toString()));}catch(error){throw new CliError('invalid_resource',error instanceof Error?error.message:String(error));}};
/** The declared type of a literal YAML file, when it names an account resource. */
function declaredAccountType(bytes:Buffer):'profile'|'session'|undefined{
 let value:unknown;try{value=parseLiteralYaml(bytes.toString());}catch{return undefined;}
 const type=(value as {type?:unknown})?.type;
 if(typeof type!=='string')return undefined;
 const normalized=type.replace(/[A-Z]/g,character=>character.toLowerCase());
 return (ACCOUNT_RESOURCE_TYPES as readonly string[]).includes(normalized)?normalized as 'profile'|'session':undefined;
}
/**
 * The store is the CLI's own state, never the workspace's: a read must not
 * create it. An absent database is simply a workspace nothing is tracked in.
 */
async function withStore<T>(workspace:Workspace,run:(state:State|null)=>Promise<T>):Promise<T>{
 return run(await readState(workspace.home));
}
/**
 * `stageFiles` still journals through a directory inside the workspace. Once the
 * journal has been applied nothing of ours belongs there, so the empty directory
 * goes too and the workspace keeps only the user's files. This disappears with
 * the file journal itself, when staged files become `staged-file` records.
 */
/** An interrupted write of this workspace, waiting for the command that started it to finish it. */
const pendingOperation=(workspace:Workspace)=>withStore(workspace,async state=>!!state?.get(workspace.root,'pending-operation','current'));
/** Everything an unchanged push must still finish: an interrupted operation, or staged files not yet applied. */
const pendingRecovery=(workspace:Workspace)=>withStore(workspace,async state=>!!state?.get(workspace.root,'pending-operation','current')||!!state?.list(workspace.root,'staged-file').length);
/** Every `account` record of this workspace, under the server and account the `workspace` record binds it to. */
async function tracking(state:State|null,workspace:Workspace):Promise<Tracking|null>{
 const binding=state?.get<{server:string;account:string}>(workspace.root,'workspace',workspace.root);
 if(!state||!binding)return null;
 if(typeof binding.value?.server!=='string'||typeof binding.value?.account!=='string')throw new CliError('invalid_lock','This workspace is bound to an invalid server or account.',`Remove the workspace record from ${state.path}.`);
 const files:Record<string,Entry>={};const ids=new Set<string>();
 // A session carries no compare-and-swap state: it is observed, never written.
 for(const record of state.list<Entry>(workspace.root,'account')){
  const entry=record.value;await confinedPath(workspace.root,record.key);accountResource(entry?.resource);
  if(!entry.resource.id||entry.resource.type==='profile'&&!entry.resource.state||!/^[a-f0-9]{64}$/.test(entry.sha256)||ids.has(entry.resource.id))throw new CliError('invalid_lock','Account tracking contains an invalid or duplicate identity.',`Inspect the account records in ${state.path}.`);
  ids.add(entry.resource.id);files[record.key]=entry;
 }
 return {server:binding.value.server,account:binding.value.account,files};
}
const trackedOfType=(saved:Tracking|null,type:'profile'|'session')=>Object.entries(saved?.files??{}).filter(([,entry])=>entry.resource.type===type).map(([path])=>path);

/**
 * Local resource files that are not account resources, so a workspace holding
 * both families reports both. Tracked artifacts come first and keep their
 * order; a discovered file is an unpublished draft the summary would otherwise
 * hide. Discovery reads the workspace root only, and a file it cannot parse is
 * left to the command that names it explicitly.
 */
async function discoverArtifactPaths(workspace:Workspace,saved:Tracking|null):Promise<string[]>{
 const found=new Set(Object.keys(workspace.tracking?.files??{}));
 let names:string[];
 try{names=(await readdir(workspace.root,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name);}catch{return [...found];}
 for(const name of names.sort()){
  if(!/\.(?:jsx|ya?ml)$/i.test(name)||found.has(name)||saved?.files[name])continue;
  if(/\.ya?ml$/i.test(name)){const bytes=await readOptional(join(workspace.root,name));if(!bytes||declaredAccountType(bytes))continue;}
  found.add(name);
 }
 return [...found];
}
/** Inspect what parses; one unreadable draft must not break a workspace summary. */
async function inspectArtifacts(workspace:Workspace,paths:string[]):Promise<LocalFile[]>{
 if(!paths.length)return [];
 try{return await inspectWorkspace(workspace,paths);}
 catch{return inspectWorkspace(workspace,Object.keys(workspace.tracking?.files??{}));}
}
const artifactType=(file:LocalFile)=>file.document?'artifact':file.resource?file.resource.type:'file';

export async function accountPlan(workspace:Workspace,parsed:ParsedCommand):Promise<AccountPlan|null>{
 const {command,flags,positionals}=parsed;
 // Remote rows: their targets are ids, never tracked local files.
 if(command==='push'&&(flags.restore||flags.refresh))return {kind:flags.restore?'restore':'refresh',paths:[...positionals],artifacts:[],manifest:null};
 if(command==='delete'&&flags.type!=='comment')return {kind:'delete',paths:[...positionals],artifacts:[],manifest:null};
 if(!['pull','push','validate','status','diff'].includes(command))return null;
 const selected=typeof flags.type==='string'&&(ACCOUNT_RESOURCE_TYPES as readonly string[]).includes(flags.type)?flags.type as 'profile'|'session':undefined;
 const selectedArtifact=typeof flags.type==='string'&&!selected;
 const saved=await withStore(workspace,state=>tracking(state,workspace));
 const paths:string[]=[];const artifacts:string[]=[];
 for(const input of positionals){
  if(selected==='profile'&&command==='pull'&&(input==='me'||/^usr_[A-Za-z0-9_-]+$/.test(input))){paths.push(input);continue;}
  const path=relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,input)));
  const bytes=await readOptional(join(workspace.root,path));
  if(selected==='session'&&command==='pull'&&!bytes){paths.push(sessionIdentity(input));continue;}
  if(bytes&&/\.ya?ml$/i.test(path)&&declaredAccountType(bytes)){parse(bytes);paths.push(path);continue;}
  if(saved?.files[path]){paths.push(path);continue;}
  artifacts.push(path);
 }
 // Mixed batches are allowed; an explicit --type that contradicts a named file
 // is not, because reinterpreting the selection would act on the wrong thing.
 if(selected&&artifacts.length)throw new CliError('type_conflict',`--type ${selected} does not describe ${artifacts[0]}.`,'Name account resources and artifact files in separate commands, or omit --type.');
 if(selectedArtifact&&paths.length)throw new CliError('type_conflict',`--type ${flags.type} does not describe ${paths[0]}.`,'Account resources use --type profile or --type session.');
 if((selected||paths.length)&&flags.format&&flags.format!=='yaml'&&!(flags.output==='-'&&flags.format==='json'))throw new CliError('unsupported_format','Editable account resources use YAML; JSON is supported on stdout.');
 if((selected||paths.length)&&flags.output==='-'&&flags.json&&flags.format!=='json')throw new CliError('conflicting_output','Use --format json for account resource JSON on stdout, or omit --json.');
 const summary=['status','diff'].includes(command);
 if(selected)return {kind:'resource',paths:paths.length?paths:trackedOfType(saved,selected),artifacts,manifest:saved};
 if(paths.length)return {kind:'resource',paths,artifacts,manifest:saved};
 if(!positionals.length&&saved&&Object.keys(saved.files).length)
  return {kind:'resource',paths:Object.keys(saved.files),artifacts:summary?await discoverArtifactPaths(workspace,saved):Object.keys(workspace.tracking?.files??{}),manifest:saved};
 return null;
}
async function entries(workspace:Workspace,plan:AccountPlan){
 const saved=plan.manifest;const results=[];
 for(const path of plan.paths){
  const bytes=await readOptional(join(workspace.root,path));const entry=saved?.files[path];const resource=bytes?parse(bytes):undefined;
  if(resource?.id&&entry&&resource.id!==entry.resource.id)throw new CliError('identity_mismatch',`${path} differs from its tracked account identity.`);
  results.push({path,bytes,entry,resource,status:!bytes?'missing':!entry?'new':digest(bytes)===entry.sha256?'unchanged':'modified'});
 }
 return results;
}
type AccountEntry=Awaited<ReturnType<typeof entries>>[number];
const entryType=(file:AccountEntry)=>file.resource?.type??file.entry?.resource.type??'profile';
/** Session resources are observed state; a push of one is refused before any request. */
function refuseSessionPush(files:AccountEntry[]):void{
 if(files.some(file=>entryType(file)==='session'))throw new CliError('readonly_resource','A remote session is observed state and cannot be published.','Terminate it with afbin delete --type session <id>; session YAML is read-only.');
}
export async function localAccountCommand(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan):Promise<unknown|undefined>{
 if(plan.kind!=='resource')return;
 if(parsed.command==='pull'||parsed.flags.remote)return;
 const files=await entries(workspace,plan);
 if(parsed.command==='push')refuseSessionPush(files);
 if(parsed.command==='validate'){
  const artifacts=plan.artifacts.length?await validateFiles(workspace,plan.artifacts,!!parsed.flags.fix):{valid:true,files:[] as unknown[]};
  const accounts=files.map(file=>({path:file.path,valid:!!file.bytes,diagnostics:file.bytes?[]:[{code:'missing_file',message:'Restore this account resource file.'}]}));
  return {valid:artifacts.valid&&accounts.every(file=>file.valid),files:[...artifacts.files,...accounts]};
 }
 if(parsed.command==='status'){
  const conflicts=await readConflicts(workspace.home,workspace.root);
  const tracked=await inspectArtifacts(workspace,plan.artifacts);
  return {remote:'last_observed',server:workspace.tracking?.server??plan.manifest?.server??null,files:[
   ...tracked.map(file=>({path:file.path,type:artifactType(file),status:file.tracked&&conflicts[file.tracked.id]?'conflicted':file.status,id:file.tracked?.id,version:(file.tracked?.observed??file.tracked?.snapshot)?.version,base_version:file.tracked?.snapshot.version,...(file.renamedFrom?{renamed_from:file.renamedFrom}:{})})),
   ...files.map(file=>({path:file.path,id:file.resource?.id??file.entry?.resource.id,status:file.status,type:entryType(file)})),
  ]};
 }
 if(parsed.command==='diff'){
  const artifacts=plan.artifacts.length?(await localDiff(workspace,plan.artifacts)).diffs:[];
  return {remote:'last_observed',diffs:[...artifacts,...files.filter(file=>file.status!=='unchanged').map(file=>({path:file.path,diff:createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,file.entry?yaml(file.entry.resource):'',file.bytes?.toString()??'')}))]};
 }
 if(parsed.command==='push'&&!await pendingRecovery(workspace)&&files.every(file=>file.status==='unchanged')){
  const artifacts=await finishLocalPush(workspace,plan.artifacts,!!parsed.flags.force);
  if(artifacts)return {operations:[...artifacts.operations,...files.map(file=>({path:file.path,status:'unchanged'}))]};
 }
}
function reconcile(base:AccountResource,local:AccountResource,remote:AccountResource):AccountResource{
 const result={...remote};
 for(const [key,value] of Object.entries(local)){
  if(['type','id','state'].includes(key)||isDeepStrictEqual(value,base[key as keyof AccountResource]))continue;
  if(!isDeepStrictEqual(remote[key as keyof AccountResource],base[key as keyof AccountResource])&&!isDeepStrictEqual(value,remote[key as keyof AccountResource]))throw new CliError('merge_conflict',`Both local and remote account settings changed ${key}.`,'Keep your file, inspect diff --remote, and resolve the field explicitly.',{fields:[key]},3);
  (result as unknown as Record<string,unknown>)[key]=value;
 }
 return result;
}
/**
 * Accept `resource` as the tracked state of `path`. The working file is staged
 * before the records are committed, so an interrupted save replays the file the
 * `account` record describes rather than claiming bytes that were never written.
 */
async function save(workspace:Workspace,path:string,resource:AccountResource,bytes:Buffer|null,working:Buffer|null,client:HttpClient){
 const account=client.account;
 if(!account)throw new CliError('unsupported_server','The server did not return an account identity.');
 const state=await stateFor(workspace.home);
 {
  const saved=await tracking(state,workspace);
  if(saved&&(saved.server!==client.connection.server||saved.account!==account))throw new CliError('account_mismatch','Account resource tracking belongs to another origin or account.');
  const duplicate=Object.entries(saved?.files??{}).find(([other,entry])=>other!==path&&entry.resource.id===resource.id)?.[0];
  if(duplicate&&await readOptional(join(workspace.root,duplicate)))throw new CliError('duplicate_identity',`${duplicate} already tracks this ${resource.type}.`);
  const changes:FileChange[]=working?[{path,before:bytes?digest(bytes):null,data:working}]:[];
  if(changes.length)await stageFiles(workspace.home,workspace.root,changes);
  state.transaction(()=>{
   state.put(workspace.root,'workspace',workspace.root,{server:client.connection.server,account},{exclusive:true});
   if(duplicate)state.delete(workspace.root,'account',duplicate);
   state.put(workspace.root,'account',path,{resource,sha256:digest(Buffer.from(yaml(resource)))});
  });
  if(changes.length){await recoverFiles(workspace.home,workspace.root);}
 }
}
/** Where a pulled session lands: its tracked path, an explicit --output, or a free name. */
async function destination(workspace:Workspace,parsed:ParsedCommand,input:string|undefined,fallback:string,many:boolean):Promise<string>{
 const output=typeof parsed.flags.output==='string'?parsed.flags.output:undefined;
 if(output){
  let path=relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,output)));
  const directory=(await stat(join(workspace.root,path)).catch(()=>null))?.isDirectory();
  if(many&&!directory)throw new CliError('ambiguous_output','Several resources need an --output directory.','Create the directory, or pull one resource at a time.');
  if(directory)path=join(path,fallback);
  return path;
 }
 return input&&/\.ya?ml$/i.test(input)?input:fallback;
}
async function pullSessions(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan,client:HttpClient):Promise<{value?:unknown;content?:string}>{
 const saved=plan.manifest;
 const targets=plan.paths.map(input=>({input,id:saved?.files[input]?.resource.id??sessionIdentity(input)}));
 if(!targets.length)throw new CliError('invalid_arguments','Name the session to retrieve.','Run afbin list --type session for its id.');
 // Each save adds a record, so a later target sees what an earlier one accepted.
 const tracked=new Map(Object.entries(saved?.files??{}));
 const operations=[];
 for(const target of targets){
  const resource=await readSession(client,target.id);
  if(parsed.flags.output==='-'&&targets.length===1)return {content:parsed.flags.format==='json'?JSON.stringify(resource)+'\n':yaml(resource)};
  const path=await destination(workspace,parsed,tracked.has(target.input)?target.input:undefined,sessionFileName(target.id),targets.length>1);
  const before=await readOptional(join(workspace.root,path));
  if(before&&!tracked.has(path)&&!parsed.flags.force)throw new CliError('output_exists',`${path} already exists.`,'Choose another --output path.');
  if(parsed.flags['dry-run']){operations.push({path,id:target.id,type:'session',status:'would_pull'});continue;}
  // Sessions are observed, never merged: the file is read-only, so replacing it
  // with what the relay reports cannot lose an edit anybody was allowed to make.
  await save(workspace,path,resource,before,Buffer.from(yaml(resource)),client);
  tracked.set(path,{resource,sha256:digest(Buffer.from(yaml(resource)))});
  operations.push({path,id:target.id,type:'session',status:'pulled'});
 }
 return {value:{...(parsed.flags['dry-run']?{dry_run:true}:{}),operations}};
}
async function pullProfile(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan,client:HttpClient):Promise<{value?:unknown;content?:string}>{
 const current=parseAccountResource(await client.request('/account/profile'));
 if(plan.paths.length>1)throw new CliError('duplicate_identity','This account has one profile; select one destination.');
 const input=plan.paths[0];if(input?.startsWith('usr_')&&input!==current.id)throw new CliError('identity_mismatch','The requested profile belongs to a different account.');
 if(parsed.flags.output==='-')return {content:parsed.flags.format==='json'?JSON.stringify(current)+'\n':yaml(current)};
 let path=typeof parsed.flags.output==='string'?relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,parsed.flags.output))):input&&input!=='me'&&!input.startsWith('usr_')?input:'profile.yaml';
 if((await stat(join(workspace.root,path)).catch(()=>null))?.isDirectory())path=join(path,'profile.yaml');
 const before=await readOptional(join(workspace.root,path));const entry=(await withStore(workspace,state=>tracking(state,workspace)))?.files[path];
 if(before&&!entry&&!parsed.flags.force)throw new CliError('output_exists',`${path} already exists.`,'Choose another --output path.');
 const merged=before&&entry&&!parsed.flags.force?reconcile(entry.resource,parse(before),current):current;
 if(parsed.flags['dry-run'])return {value:{dry_run:true,operations:[{path,status:'would_pull',type:'profile',id:current.id}]}};
 // A forced pull replaces local edits, so the bytes it discards are kept outside the workspace and named absolutely.
 const backup=parsed.flags.force&&before&&!before.equals(Buffer.from(yaml(merged)))?await localBackup(workspace.home,path,before):undefined;
 await save(workspace,path,current,before,Buffer.from(yaml(merged)),client);return {value:{operations:[{path,id:current.id,type:'profile',status:'pulled',...(backup?{backup}:{})}]}};
}
export async function remoteAccountCommand(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan,client:HttpClient):Promise<{value?:unknown;content?:string;exitCode?:number}>{
 if(plan.kind==='restore')return {value:await pushRestore(workspace,plan.paths,client)};
 if(plan.kind==='refresh')return {value:await pushRefresh(workspace,plan.paths,client)};
 if(plan.kind==='delete')return deleteResources(workspace,parsed,client);
 if(plan.manifest&&(plan.manifest.server!==client.connection.server||client.account&&plan.manifest.account!==client.account))throw new CliError('account_mismatch','Use the tracked account and server.');
 if(plan.manifest)client.account=plan.manifest.account;
 const sessions=parsed.flags.type==='session'?plan.paths:parsed.flags.type==='profile'?[]:plan.paths.filter(path=>plan.manifest?.files[path]?.resource.type==='session');
 const profiles=plan.paths.filter(path=>!sessions.includes(path));
 if(parsed.command==='pull')return withLock(workspace.home,workspace.root,async()=>{
  const operations:unknown[]=[];
  if(sessions.length){
   const result=await pullSessions(workspace,parsed,{...plan,paths:sessions},client);
   if(result.content!==undefined)return result;
   operations.push(...(result.value as {operations:unknown[]}).operations);
  }
  if(profiles.length||!sessions.length){
   const result=await pullProfile(workspace,parsed,{...plan,paths:profiles},client);
   if(result.content!==undefined)return result;
   operations.push(...(result.value as {operations:unknown[]}).operations);
  }
  if(plan.artifacts.length){
   const result=await pull(workspace,plan.artifacts,client,{format:parsed.flags.format as string|undefined,output:parsed.flags.output as string|undefined,force:!!parsed.flags.force,dryRun:!!parsed.flags['dry-run']});
   operations.unshift(...result.operations as unknown[]);
  }
  return {value:{...(parsed.flags['dry-run']?{dry_run:true}:{}),operations}};
 });
 const files=await entries(workspace,plan);
 if(parsed.command==='status'||parsed.command==='diff'){
  if(sessions.length)throw new CliError('unsupported_flag','A session has no remote comparison; a pulled session file already is what the relay reported.','Run afbin status --type session without --remote, or pull it again.');
  const current=parseAccountResource(await client.request('/account/profile'));
  return {value:parsed.command==='status'?{remote:'current',files:files.map(file=>({path:file.path,status:file.status,remote_changed:file.entry?.resource.state!==current.state}))}:{remote:'current',diffs:files.map(file=>({path:file.path,diff:createTwoFilesPatch(`remote/${file.path}`,`local/${file.path}`,yaml(current),file.bytes?.toString()??'')}))}};
 }
 refuseSessionPush(files);
 const operations:Array<Record<string,unknown>>=[];
 for(const file of files){
  if(!file.resource||!file.bytes)throw new CliError('missing_file',`Missing account resource: ${file.path}.`);
  if(file.resource.type!=='profile')throw new CliError('unsupported_type','This account command requires a profile.');
  if(file.status==='unchanged'&&!await pendingOperation(workspace)){operations.push({path:file.path,status:'unchanged'});continue;}
  const proposal=file.resource;
  const prepare=async()=>{
   const current=parseAccountResource(await client.request('/account/profile'));if(current.type!=='profile')throw new CliError('invalid_response','Expected a profile response.');
   if(proposal.id&&proposal.id!==current.id)throw new CliError('identity_mismatch','The local profile belongs to another account.');
   const desired=file.entry&&!parsed.flags.force?reconcile(file.entry.resource,proposal,current):{...current,...proposal,id:current.id,state:current.state};
   if(desired.type!=='profile')throw new CliError('invalid_resource','Expected profile settings.');
   for(const key of ['email','name'] as const)if(desired[key]!==current[key])throw new CliError('readonly_field',`${key} is observed account identity and cannot be edited here.`);
   return {body:desired,context:proposal};
  };
  if(parsed.flags['dry-run']){await prepare();operations.push({path:file.path,status:'would_push'});continue;}
  const result=await recoverableOperation(workspace,client,{path:'/account/profile',method:'PATCH',body:proposal,identity:{type:'profile',id:proposal.id??'me'},prepare,finalize:async(response,context)=>{
   const resource=parseAccountResource(response);const before=await readOptional(join(workspace.root,file.path));let working:Buffer|null=null;
   if(before){
    const now=parse(before),original=context as ProfileResource;const updated={...resource} as unknown as Record<string,unknown>;
    for(const [key,value] of Object.entries(now))if(!['type','id','state','email','name'].includes(key)&&!isDeepStrictEqual(value,original[key as keyof ProfileResource]))updated[key]=value;
    working=Buffer.from(yaml(updated));
   }
   await save(workspace,file.path,resource,before,working,client);
  }});
  operations.push({path:file.path,id:result.id,status:'pushed',operation:result.operation});
 }
 if(plan.artifacts.length){
  const result=await push(workspace,plan.artifacts,client,{force:!!parsed.flags.force,dryRun:!!parsed.flags['dry-run']});
  operations.unshift(...result.operations);
 }
 return {value:{...(parsed.flags['dry-run']?{dry_run:true}:{}),operations}};
}
/** `list --type session`: the account's relayed terminals as a typed collection. */
export async function listAccountCollection(parsed:ParsedCommand,client:HttpClient):Promise<{sessions:SessionResource[]}>{
 for(const flag of ['in','filter','cursor'] as const)if(parsed.flags[flag]!==undefined)throw new CliError('unsupported_flag',`Sessions are an unpaged in-memory collection and do not accept --${flag}.`,'Run afbin list --type session.');
 return listSessions(client,parsed.flags.limit!==undefined?Number(parsed.flags.limit):20);
}
