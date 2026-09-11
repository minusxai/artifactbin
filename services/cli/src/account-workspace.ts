import {join,relative,resolve,dirname} from 'node:path';
import {stat} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {stringify} from 'yaml';
import {createTwoFilesPatch} from 'diff';
import {parseAccountResource} from '@artifactbin/utils/account-resource';
import type {AccountResource,ProfileResource} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {parseLiteralYaml} from './document';
import {atomicWrite,digest,privateDirectory,readOptional} from './files';
import {confinedPath,stageFiles,recoverFiles,type FileChange} from './journal';
import {withProcessLock} from './process-lock';
import {recoverableOperation} from './recoverable-operation';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';
const manifestPath='.artifactbin/accounts.json';
interface Entry {resource:AccountResource;baseline:string}
interface Manifest {schema:1;server:string;account:string;files:Record<string,Entry>}
export interface AccountPlan {paths:string[];manifest:Manifest|null}
const yaml=(value:unknown)=>stringify(value,{lineWidth:0});
const parse=(bytes:Buffer)=>{try{return parseAccountResource(parseLiteralYaml(bytes.toString()));}catch(error){throw new CliError('invalid_resource',error instanceof Error?error.message:String(error));}};
async function manifest(workspace:Workspace):Promise<{value:Manifest|null;bytes:Buffer|null}>{
 const bytes=await readOptional(join(workspace.root,manifestPath));if(!bytes)return {value:null,bytes};
 let value:Manifest;try{value=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_lock','Account tracking is not valid JSON.');}
 if(value.schema!==1||!value.server||!value.account||!value.files||typeof value.files!=='object')throw new CliError('invalid_lock','Account tracking has an invalid schema.');
 const ids=new Set<string>();
 for(const [path,entry] of Object.entries(value.files)){await confinedPath(workspace.root,path);parseAccountResource(entry.resource);if(!entry.resource.id||!entry.resource.state||typeof entry.baseline!=='string'||ids.has(entry.resource.id))throw new CliError('invalid_lock','Account tracking contains an invalid or duplicate identity.');ids.add(entry.resource.id);}
 return {value,bytes};
}
export async function accountPlan(workspace:Workspace,parsed:ParsedCommand):Promise<AccountPlan|null>{
 if(!['pull','push','validate','status','diff'].includes(parsed.command))return null;
 const selected=parsed.flags.type==='profile';const saved=(await manifest(workspace)).value;
 const paths:string[]=[];let other=false;
 for(const input of parsed.positionals){
  if(selected&&parsed.command==='pull'&&(input==='me'||/^usr_[A-Za-z0-9_-]+$/.test(input))){paths.push(input);continue;}
  const path=relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,input)));const bytes=await readOptional(join(workspace.root,path));
  if(bytes&&/\.ya?ml$/i.test(path)){
   const value=parseLiteralYaml(bytes.toString()) as {type?:unknown};
   if(typeof value.type==='string'&&value.type.toLowerCase()==='profile'){parse(bytes);paths.push(path);continue;}
  }
  if(saved?.files[path]?.resource.type==='profile'){paths.push(path);continue;}
  other=true;
 }
 if(other&&(selected||paths.length))throw new CliError('mixed_resource_batch','Select profile files separately from artifact files.');
 if((selected||paths.length)&&parsed.flags.format&&parsed.flags.format!=='yaml'&&!(parsed.flags.output==='-'&&parsed.flags.format==='json'))throw new CliError('unsupported_format','Editable profiles use YAML; JSON is supported on stdout.');
 if((selected||paths.length)&&parsed.flags.output==='-'&&parsed.flags.json&&parsed.flags.format!=='json')throw new CliError('conflicting_output','Use --format json for profile JSON on stdout, or omit --json.');
 if(selected)return {paths:paths.length?paths:Object.keys(saved?.files??{}),manifest:saved};
 if(paths.length)return {paths,manifest:saved};
 if(!parsed.positionals.length&&saved&&Object.keys(saved.files).length){
  if(Object.keys(workspace.lock?.files??{}).length)throw new CliError('mixed_resource_batch','This workspace contains artifact and account resources.','Select explicit files, or use --type profile for account resources.');
  return {paths:Object.keys(saved.files),manifest:saved};
 }
 return null;
}
async function entries(workspace:Workspace,plan:AccountPlan){
 const saved=(await manifest(workspace)).value;const results=[];
 for(const path of plan.paths){
  const bytes=await readOptional(join(workspace.root,path));const entry=saved?.files[path];const resource=bytes?parse(bytes):undefined;
  if(resource?.id&&entry&&resource.id!==entry.resource.id)throw new CliError('identity_mismatch',`${path} differs from its tracked account identity.`);
  results.push({path,bytes,entry,resource,status:!bytes?'missing':!entry?'new':bytes.toString('base64')===entry.baseline?'unchanged':'modified'});
 }
 return results;
}
export async function localAccountCommand(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan):Promise<unknown|undefined>{
 if(parsed.command==='pull'||parsed.flags.remote)return;
 const files=await entries(workspace,plan);
 if(parsed.command==='validate')return {valid:files.every(file=>file.bytes),files:files.map(file=>({path:file.path,valid:!!file.bytes,diagnostics:file.bytes?[]:[{code:'missing_file',message:'Restore this account resource file.'}]}))};
 if(parsed.command==='status')return {remote:'last_observed',server:plan.manifest?.server??null,files:files.map(file=>({path:file.path,id:file.resource?.id??file.entry?.resource.id,status:file.status,type:'profile'}))};
 if(parsed.command==='diff')return {remote:'last_observed',diffs:files.filter(file=>file.status!=='unchanged').map(file=>({path:file.path,diff:createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,file.entry?Buffer.from(file.entry.baseline,'base64').toString():'',file.bytes?.toString()??'')}))};
 if(parsed.command==='push'&&!await readOptional(join(workspace.root,'.artifactbin','pending-operation.json'))&&!await readOptional(join(workspace.root,'.artifactbin','pending-files.json'))&&files.every(file=>file.status==='unchanged'))return {operations:files.map(file=>({path:file.path,status:'unchanged'}))};
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
async function save(workspace:Workspace,path:string,resource:AccountResource,bytes:Buffer|null,working:Buffer|null,client:HttpClient){
 const saved=await manifest(workspace);
 if(saved.value&&(saved.value.server!==client.connection.server||saved.value.account!==client.account))throw new CliError('account_mismatch','Account resource tracking belongs to another origin or account.');
 if(!client.account)throw new CliError('unsupported_server','The server did not return an account identity.');
 const value=saved.value??{schema:1,server:client.connection.server,account:client.account,files:{}};
 const duplicate=Object.entries(value.files).find(([other,entry])=>other!==path&&entry.resource.id===resource.id);
 if(duplicate){if(await readOptional(join(workspace.root,duplicate[0])))throw new CliError('duplicate_identity',`${duplicate[0]} already tracks this profile.`);delete value.files[duplicate[0]];}
 value.files[path]={resource,baseline:Buffer.from(yaml(resource)).toString('base64')};
 const changes:FileChange[]=[{path:manifestPath,before:saved.bytes?digest(saved.bytes):null,data:Buffer.from(JSON.stringify(value,null,2)+'\n')}];
 if(working)changes.unshift({path,before:bytes?digest(bytes):null,data:working});
 await stageFiles(workspace.root,changes);await recoverFiles(workspace.root);
}
export async function remoteAccountCommand(workspace:Workspace,parsed:ParsedCommand,plan:AccountPlan,client:HttpClient):Promise<{value?:unknown;content?:string}>{
 if(plan.manifest&&(plan.manifest.server!==client.connection.server||client.account&&plan.manifest.account!==client.account))throw new CliError('account_mismatch','Use the tracked account and server.');
 if(plan.manifest)client.account=plan.manifest.account;
 if(parsed.command==='pull')return withProcessLock(workspace.root,async()=>{
  const current=parseAccountResource(await client.request('/account/profile'));
  if(plan.paths.length>1)throw new CliError('duplicate_identity','This account has one profile; select one destination.');
  const input=plan.paths[0];if(input?.startsWith('usr_')&&input!==current.id)throw new CliError('identity_mismatch','The requested profile belongs to a different account.');
  if(parsed.flags.output==='-')return {content:parsed.flags.format==='json'?JSON.stringify(current)+'\n':yaml(current)};
  let path=typeof parsed.flags.output==='string'?relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,parsed.flags.output))):input&&input!=='me'&&!input.startsWith('usr_')?input:'profile.yaml';
  if((await stat(join(workspace.root,path)).catch(()=>null))?.isDirectory())path=join(path,'profile.yaml');
  const before=await readOptional(join(workspace.root,path));const entry=(await manifest(workspace)).value?.files[path];
  if(before&&!entry&&!parsed.flags.force)throw new CliError('output_exists',`${path} already exists.`,'Choose another --output path.');
  const merged=before&&entry&&!parsed.flags.force?reconcile(entry.resource,parse(before),current):current;
  if(parsed.flags['dry-run'])return {value:{dry_run:true,operations:[{path,status:'would_pull',type:'profile',id:current.id}]}};
  if(parsed.flags.force&&before&&!before.equals(Buffer.from(yaml(merged)))){const backup=join(workspace.root,'.artifactbin','local-backups',randomUUID(),'profile.yaml');await privateDirectory(dirname(backup));await atomicWrite(backup,before,{exclusive:true});}
  await save(workspace,path,current,before,Buffer.from(yaml(merged)),client);return {value:{operations:[{path,id:current.id,type:'profile',status:'pulled'}]}};
 });
 const files=await entries(workspace,plan);
 if(parsed.command==='status'||parsed.command==='diff'){
  const current=parseAccountResource(await client.request('/account/profile'));
  return {value:parsed.command==='status'?{remote:'current',files:files.map(file=>({path:file.path,status:file.status,remote_changed:file.entry?.resource.state!==current.state}))}:{remote:'current',diffs:files.map(file=>({path:file.path,diff:createTwoFilesPatch(`remote/${file.path}`,`local/${file.path}`,yaml(current),file.bytes?.toString()??'')}))}};
 }
 const operations=[];
 for(const file of files){
  if(!file.resource||!file.bytes)throw new CliError('missing_file',`Missing account resource: ${file.path}.`);
  if(file.resource.type!=='profile')throw new CliError('unsupported_type','This account command requires a profile.');
  if(file.status==='unchanged'&&!await readOptional(join(workspace.root,'.artifactbin','pending-operation.json'))){operations.push({path:file.path,status:'unchanged'});continue;}
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
 return {value:{...(parsed.flags['dry-run']?{dry_run:true}:{}),operations}};
}
