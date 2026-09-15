import {resolve} from 'node:path';
import {ARTIFACT_ID_PATTERN,ADMIN_DOCUMENT_HEADER,type AdminDocument} from '@artifactbin/contracts';
import {CliError} from './errors';
import type {HttpClient} from './http';
import type {Workspace} from './workspace';
import {confinedPath} from './journal';
import {atomicWrite, readOptional} from './files';
import {parseDocument,writeDocument} from './document';

const headers={[ADMIN_DOCUMENT_HEADER]:'1'};
const local=(doc:AdminDocument)=>writeDocument({metadata:{id:doc.id,edit_id:doc.edit_id,head_version:doc.version,title:doc.title},body:doc.source});

/** Administrative files are explicit, isolated from ordinary workspace sync and auto-push. */
export async function adminCommand(client:HttpClient,workspace:Workspace,args:string[],options:{output?:string;reason?:string;cursor?:string}):Promise<unknown>{
 const [action,target]=args;
 if(action==='list'){
  const query=new URLSearchParams({q:target??'',...(options.cursor?{after:options.cursor}:{})});
  return client.request(`/admin/documents?${query}`,'GET',undefined,headers);
 }
 if(action==='pull'){
  if(!target||!ARTIFACT_ID_PATTERN.test(target)||!options.output||options.output==='-')throw new CliError('invalid_arguments','Use admin pull <id> --output <file.jsx>.');
  const path=await confinedPath(workspace.root,resolve(workspace.cwd,options.output));
  if(await readOptional(path))throw new CliError('file_exists','Choose a new file for the administrative pull.');
  const doc=await client.request<AdminDocument>(`/admin/documents/${target}`,'GET',undefined,headers);
  await atomicWrite(path,local(doc),{exclusive:true});
  return {id:doc.id,version:doc.version,path:options.output};
 }
 if(action==='push'){
  if(!target||!options.reason?.trim())throw new CliError('invalid_arguments','Use admin push <file.jsx> --reason <text>.');
  const path=await confinedPath(workspace.root,resolve(workspace.cwd,target));
  const before=await readOptional(path);if(!before)throw new CliError('not_found','Repair file not found.');
  const doc=parseDocument(before.toString());
  if(!doc.metadata.id||!doc.metadata.edit_id)throw new CliError('identity_required','Use an administrative pull with its id and edit_id intact.');
  const result=await client.request<AdminDocument>(`/admin/documents/${doc.metadata.id}`,'PUT',{source:doc.body,edit_id:doc.metadata.edit_id,reason:options.reason},headers);
  const now=await readOptional(path);
  if(!now?.equals(before))return {id:result.id,version:result.version,status:'published',local:'changed_during_publish',edit_id:result.edit_id};
  await atomicWrite(path,local(result));
  return {id:result.id,version:result.version,status:'published'};
 }
 throw new CliError('invalid_arguments','Use admin list, admin pull, or admin push.');
}
