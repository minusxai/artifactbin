import {persistConflict} from './conflict-state';
import {createTwoFilesPatch} from 'diff';
import {CliError} from './commands';
import {parseDocument} from './document';
import type {HttpClient} from './http';
import type {PendingRequest} from './pending-request';

/** Conflict-only observation: successful writes never pay for a head request. */
export async function describeConflict(error:CliError,pending:PendingRequest,client:HttpClient,root:string):Promise<CliError>{
 const details=error.details&&typeof error.details==='object'?error.details as Record<string,unknown>:{};
 let head=details.head&&typeof details.head==='object'?details.head as Record<string,unknown>:details;
 if(typeof head.source!=='string'&&typeof head.markup!=='string'){
  const id=pending.file.tracked?.id??(pending.file.path.toLowerCase().endsWith('.jsx')?parseDocument(Buffer.from(pending.file.bytes,'base64').toString()).metadata.id:undefined);
  if(id)try{head=await client.request(`/artifacts/${id}`);}catch{return new CliError(error.code,error.message,'Inspect afbin diff --remote when the server is available. Your local file is unchanged.',{...details,diff_unavailable:true},error.exitCode);}
 }
 const source=pending.request.body.source??pending.request.body.markup;
 const remote=head.source??head.markup;
 const diff=typeof source==='string'&&typeof remote==='string'?createTwoFilesPatch(`remote/${pending.file.path}`,`proposed/${pending.file.path}`,remote,source,'current head','your proposal',{context:3}):undefined;
 const names:Record<string,string>={linkRole:'link_role',parent_id:'parent_id'};
 const metadata=Object.fromEntries(Object.entries(pending.request.body).filter(([key])=>['title','description','theme','template','visibility','linkRole','parent_id'].includes(key)).map(([key,proposed])=>[key,{current:head[names[key]??key],proposed}]));
 const result=new CliError(error.code,error.message,'Review the conflict and preserve both writers. Edit the local file and retry, or use pull --force only after saving your proposal.',{...details,head,...(diff!==undefined?{diff}:{}),...(Object.keys(metadata).length?{metadata}:{})},error.exitCode);
 const id=typeof head.id==='string'?head.id:pending.file.tracked?.id;
 return id?persistConflict(root,id,pending.file.path,result):result;
}
