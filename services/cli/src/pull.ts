import {persistConflict,clearConflict} from './conflict-state';
import {randomUUID} from 'node:crypto';
import {join,relative,resolve,extname,basename,dirname} from 'node:path';
import {CliError} from './commands';
import {resolveReference} from './reference';
import {parseDocument,writeDocument} from './document';
import {snapshotDocument} from './local';
import {atomicWrite,digest,privateDirectory,readOptional} from './files';
import {confinedPath,recoverFiles,stageFiles,type FileChange} from './journal';
import {withProcessLock} from './process-lock';
import {archivePendingRequest,clearPendingRequest,readPendingRequest} from './pending-request';
import {loadWorkspace,type Workspace,type WorkspaceLock,type Snapshot} from './workspace';
import {HttpClient} from './http';
import {restoreDependencyPaths} from './dependencies';
import {reconcileDocument} from './reconcile';
interface PullTarget {id:string;version?:number;path?:string;before:Buffer|null;previousPath?:string}
export async function preparePull(workspace:Workspace,args:string[],force=false,server=workspace.lock?.server):Promise<PullTarget[]>{
 const requested=args.length?[args]:Object.entries(workspace.lock?.files??{}).map(([path,file])=>[file.id,resolve(workspace.root,path)]);
 const targets:PullTarget[]=[];
 for(const [input,destination]of requested){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server});
  let path=destination?relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,destination))):ref.kind==='path'?ref.path:undefined;
  const document=ref.kind==='path'&&ref.path.toLowerCase().endsWith('.jsx')?parseDocument((await readOptional(join(workspace.root,ref.path)))!.toString()):undefined;
  const id=ref.kind==='id'?ref.id:document?.metadata.id??workspace.lock?.files[ref.path]?.id;
  if(!id)throw new CliError('identity_required',`The file ${input} has no artifact id.`,'Use afbin push to publish it first, or pull an explicit artifact id into a new path.');
  const prior=Object.entries(workspace.lock?.files??{}).find(([,file])=>file.id===id);
  path??=prior?.[0];
  if(path&&prior&&prior[0]!==path&&await readOptional(join(workspace.root,prior[0])))throw new CliError('duplicate_identity',`${prior[0]} already tracks ${id}.`,'Pull the tracked path; do not create another working copy with the same identity.');
  if(path&&workspace.lock?.files[path]&&workspace.lock.files[path].id!==id)throw new CliError('identity_mismatch',`${path} tracks a different artifact.`);
  const before=path?await readOptional(await confinedPath(workspace.root,path)):null;
  const tracked=path?workspace.lock?.files[path]:undefined;
  if(before&&!force&&(!tracked||digest(before)!==digest(Buffer.from(tracked.baseline,'base64')))&&(!tracked||ref.version||!path?.toLowerCase().endsWith('.jsx')))throw new CliError('local_changed',`${path} has local changes.`,'Save a backup and inspect afbin diff. Use pull --force only to overwrite this file.');
  targets.push({id,...(ref.version?{version:ref.version}:{}),path,before,...(prior&&prior[0]!==path?{previousPath:prior[0]}:{})});
 }
 return targets;
}
export async function pull(workspace:Workspace,args:string[],client:HttpClient,options:{force?:boolean;dryRun?:boolean}={}){
 const run=async()=>{
  if(!options.dryRun){await recoverFiles(workspace.root);workspace=await loadWorkspace(workspace.cwd);}
  const pending=await readPendingRequest(workspace.root);
  const targets=await preparePull(workspace,args,!!options.force,client.connection.server);
  const pendingId=pending?.request.path.match(/^\/artifacts\/([A-Za-z0-9]{6,12})(?:\/edits)?$/)?.[1];
  if(pending&&(!options.force||options.dryRun||!pendingId||!targets.some(target=>target.id===pendingId)))throw new CliError('pending_recovery','Recover the pending write with afbin push before pulling.','An ambiguous conditional write may instead be resolved with pull --force on the same artifact; its proposal is archived first.');
  const files:FileChange[]=[];let lock=workspace.lock?structuredClone(workspace.lock):null;
  const operations=[];
  for(const target of targets){
   const head=await client.request<Snapshot>(`/artifacts/${target.id}`);
   if(head.id!==target.id||typeof head.edit_id!=='string'||typeof head.state!=='string'||!Number.isSafeInteger(head.version))throw new CliError('invalid_response','The server did not return a complete artifact snapshot.');
   const previous=target.path?workspace.lock?.files[target.path]:undefined;
   let selected:Snapshot|undefined;
   if(target.version&&target.version!==head.version){
    selected=previous?.versions?.[String(target.version)];
    if(!selected){const history=await client.request<Record<string,unknown>>(`/artifacts/${target.id}/versions/${target.version}`);const meta=history.meta as Record<string,unknown>|undefined;selected={...head,...history,id:head.id,version:target.version,edit_id:head.edit_id,state:head.state,theme:meta?.theme as string|null??head.theme,template:meta?.template as string|null??head.template} as Snapshot;}
   }
   const snapshot=selected??head;
   const path=target.path??`${target.id}${defaultExtension(snapshot)}`;
   const before=target.path?target.before:await readOptional(await confinedPath(workspace.root,path));
   if(before&&!target.path&&!options.force)throw new CliError('local_changed',`${path} already exists. Choose a destination or use --force.`);
   let bytes:Buffer;let baseline:Buffer|undefined;
   if(snapshot.format==='markup'||snapshot.format==='folder'){
    const document=snapshotDocument({...snapshot,edit_id:head.edit_id,state:head.state});document.metadata.head_version=head.version;if(target.version)document.metadata.version=target.version;
    document.body=await restoreDependencyPaths(document.body,previous?.paths??{},path,workspace.root);
    baseline=Buffer.from(writeDocument(document));bytes=baseline;
    if(before&&previous&&!options.force&&!target.version&&digest(before)!==digest(Buffer.from(previous.baseline,'base64'))){
     const merged=reconcileDocument(parseDocument(Buffer.from(previous.baseline,'base64').toString()),parseDocument(before.toString()),document);
     if(!merged.ok){
      const error=new CliError('merge_conflict',`${path} has overlapping local and remote changes.`,'Preserve your proposal and resolve the reported regions before publishing.',{path,fields:merged.fields,base:Buffer.from(previous.baseline,'base64').toString(),local:before.toString(),remote:baseline.toString(),head},3);
      throw options.dryRun?error:await persistConflict(workspace.root,target.id,path,error);
     }
     bytes=Buffer.from(writeDocument(merged.document));
    }
   }else if(['dataset','image','pdf','file'].includes(snapshot.format??'')){
    const content=await client.content(`/artifacts/${target.id}/content?version=${snapshot.version}`);
    if(snapshot.format==='dataset'){
     let rows:unknown;try{rows=JSON.parse(content.bytes.toString());}catch{throw new CliError('invalid_response','Dataset content is not JSON.');}
     if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_response','Dataset content must contain row objects.');
     bytes=Buffer.from(extname(path).toLowerCase()==='.csv'?rowsCsv(rows):JSON.stringify(rows,null,2)+'\n');
    }else bytes=content.bytes;
   }else throw new CliError('unsupported_pull_format',`The ${snapshot.format} artifact has no local file representation.`,'Use afbin api to inspect its definition.');
   const backup=options.force&&before&&!before.equals(bytes)?`.artifactbin/local-backups/${randomUUID()}/${basename(path)}`:undefined;
   operations.push({path,...(backup?{backup}:{}),id:head.id,version:snapshot.version,head_version:head.version,status:options.dryRun?'would_write':'pulled'});
   if(options.dryRun)continue;
   if(!client.account)throw new CliError('unsupported_server','The server did not return account identity.');
   lock??={schema:1,server:client.connection.server,account:client.account,root:randomUUID(),files:{}} satisfies WorkspaceLock;
   if(target.previousPath)delete lock.files[target.previousPath];
   lock.files[path]={id:head.id,url:typeof head.url==='string'?head.url:`${client.connection.server}/a/${head.id}`,file:digest(bytes),base:digest(JSON.stringify(head)),baseline:(baseline??bytes).toString('base64'),snapshot:head,...(previous?.paths?{paths:previous.paths}:{}),...(selected?{selected,versions:{...previous?.versions,[String(selected.version)]:selected}}:previous?.versions?{versions:previous.versions}:{})};
   if(backup&&before){
    const destination=await confinedPath(workspace.root,backup);
    await privateDirectory(join(workspace.root,'.artifactbin'));
    await privateDirectory(join(workspace.root,'.artifactbin','local-backups'));
    await privateDirectory(dirname(destination));
    await atomicWrite(destination,before,{exclusive:true});
   }
   files.push({path,before:before?digest(before):null,data:bytes});
  }
  const recovery=pending?await archivePendingRequest(workspace.root,pending,await readOptional(await confinedPath(workspace.root,pending.file.path))):undefined;
  if(lock&&files.length){files.push({path:'afbin.lock',before:workspace.raw?digest(workspace.raw):null,data:Buffer.from(JSON.stringify(lock,null,2)+'\n')});await stageFiles(workspace.root,files);await recoverFiles(workspace.root);}
  if(lock&&files.length)for(const target of targets)await clearConflict(workspace.root,target.id);
  if(pending&&lock&&files.length)await clearPendingRequest(workspace.root);
  return{...(options.dryRun?{dry_run:true}:{}),...(recovery?{recovered_request:recovery}:{}),operations};
 };
 return options.dryRun?run():withProcessLock(workspace.root,run);
}

function defaultExtension(snapshot:Snapshot):string{
 if(snapshot.format==='dataset')return '.json';
 if(snapshot.format==='pdf')return '.pdf';
 if(snapshot.format==='file'&&typeof snapshot.filename==='string')return extname(snapshot.filename).replace(/[^.a-zA-Z0-9]/g,'')||'.bin';
 if(snapshot.format==='image')return ({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg'} as Record<string,string>)[String(snapshot.contentType)]??'.bin';
 return '.jsx';
}
function rowsCsv(rows:Record<string,unknown>[]):string{
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 const cell=(value:unknown)=>{const text=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
 return [columns.map(cell).join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\n')+'\n';
}
