import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CliError,type ParsedCommand} from './commands';
import {parseDocument} from './document';
import {resolveReference} from './reference';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';

/** All native commands share file identity resolution; no identity HTTP request. */
export async function artifactReference(workspace:Workspace,input:string,server:string,writable=false){
 const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server,writable});
 if(ref.kind==='id')return{id:ref.id,version:ref.version,notices:ref.notices};
 const tracked=workspace.lock?.files[ref.path];
 const id=ref.path.endsWith('.jsx')?parseDocument(await readFile(join(workspace.root,ref.path),'utf8')).metadata.id:tracked?.id;
 if(!id)throw new CliError('unpublished_file',`${ref.path} has no published identity.`,'Publish it with afbin push first.');
 if(tracked&&tracked.id!==id)throw new CliError('identity_mismatch',`The fence identity for ${ref.path} differs from afbin.lock.`,'Resolve the identity before operating on the remote artifact.');
 return{id,version:ref.version,path:ref.path,notices:ref.notices};
}
export function pageQuery(flags:ParsedCommand['flags']):string{
 const params=new URLSearchParams();
 for(const key of ['limit','cursor'])if(typeof flags[key]==='string')params.set(key,flags[key] as string);
 return params.size?`?${params}`:'';
}
export async function readCommand(workspace:Workspace,parsed:ParsedCommand,client:HttpClient){
 if(parsed.command==='list')return client.request(`/artifacts${pageQuery(parsed.flags)}`);
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server);
 const query=new URLSearchParams(pageQuery(parsed.flags));if(ref.version!==undefined)query.set('version',String(ref.version));
 return client.request(`/artifacts/${ref.id}/versions${query.size?'?'+query:''}`);
}

export async function commentCommand(workspace:Workspace,parsed:ParsedCommand,client:HttpClient,body?:string){
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server,true);
 const {flags}=parsed;const path=`/artifacts/${ref.id}/annotations`;
 if(flags.reply){
  if(!/^[A-Za-z0-9_-]+$/.test(String(flags.reply)))throw new CliError('invalid_thread','Use the thread id returned by afbin comment.');
  return client.request(`${path}/${flags.reply}`,'POST',{...(body!==undefined?{reply:body}:{}),...(flags.resolve?{resolve:true}:{})});
 }
 if(body!==undefined)return client.request(path,'POST',{body,...(flags.node?{node_id:flags.node}:{quote:flags.quote})});
 return client.request(`${path}${pageQuery(flags)}`);
}
