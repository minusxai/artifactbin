import {parseProgramDefinition,type ScheduledExecution} from '@artifactbin/contracts';
import {getArtifactById} from '../artifacts/store';

export {parseProgramDefinition} from '@artifactbin/contracts';

/** Sharing permits reading the definition, never allocating compute under its owner's credentials. */
export async function resolveProgramArtifact(artifactId:string,userId:string):Promise<ScheduledExecution|null>{
 const row=await getArtifactById(artifactId);
 if(!userId||!row||row.deleted_at||row.format!=='program'||row.user_id!==userId||!row.source)return null;
 const definition=parseProgramDefinition(row.source);
 return {artifactId:row.id,artifactVersion:String(row.version),name:`program:${row.id}`,program:{source:'',language:'javascript'},command:definition.command,compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600,...definition.compute},...(definition.env?{env:definition.env}:{})};
}
