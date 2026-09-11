import {CliError,type ParsedCommand} from './commands';
import {artifactReference} from './read-commands';
import {queryParameters} from './local-query';
import {batchCommand} from './batch';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';

export async function remoteQuery(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,client:HttpClient){
 const {flags}=parsed;
 return batchCommand(parsed.positionals,async target=>{
  const ref=await artifactReference(workspace,target,client.connection.server);
  if(ref.version!==undefined)throw new CliError('historical_query','Remote queries operate on the current resource.','Pull the historical version, then query the local data.');
  return client.request(`/artifacts/${ref.id}/query`,'POST',{
   ...(sql===undefined?{}:{sql}),values:queryParameters(flags.param as string[]|undefined),
   ...(flags.name?{name:flags.name}:{}),limit:Number(flags.limit??20),
   ...(flags.cursor?{cursor:flags.cursor}:{}),...(flags.remote?{refresh:true}:{}),
  },{},{readOnly:true});
 });
}
