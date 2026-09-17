import {randomUUID} from 'node:crypto';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {CliError} from './errors';
import {readState,stateFor} from './state-access';
interface SavedConflict {path:string;code:string;details:unknown}
const CONFLICT_FIX='Run afbin status to see the conflicted file. Resolve the working file and use push --force to accept it, or pull --force to accept remote content.';
export async function readConflicts(home:string,root:string):Promise<Record<string,SavedConflict>>{
 const conflicts:Record<string,SavedConflict>={};
 for(const record of (await readState(home))?.list<SavedConflict>(root,'conflict')??[]){
  if(!ARTIFACT_ID_PATTERN.test(record.key)||!record.value||typeof record.value.path!=='string')throw new CliError('invalid_journal','The saved conflict state is invalid.');
  conflicts[record.key]=record.value;
 }
 return conflicts;
}
export async function persistConflict(home:string,root:string,id:string,path:string,error:CliError):Promise<CliError>{
 if(!ARTIFACT_ID_PATTERN.test(id))throw new CliError('invalid_response','The conflict does not identify an artifact.');
 const state=await stateFor(home);
 state.transaction(()=>{
  const existing=state.get<SavedConflict>(root,'conflict',id);
  if(existing)state.put(root,'archive',`resolved-conflicts/${id}-${randomUUID()}`,existing.value,{exclusive:true});
  state.put(root,'conflict',id,{path,code:error.code,details:error.details});
 });
 return new CliError(error.code,error.message,CONFLICT_FIX,error.details&&typeof error.details==='object'?error.details:{},error.exitCode);
}
export async function clearConflict(home:string,root:string,id:string){
 const state=await stateFor(home);
 state.transaction(()=>{
  const existing=state.get<SavedConflict>(root,'conflict',id);if(!existing)return;
  state.put(root,'archive',`resolved-conflicts/${id}-${randomUUID()}`,existing.value,{exclusive:true});
  state.delete(root,'conflict',id);
 });
}
