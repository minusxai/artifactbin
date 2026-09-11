import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {CliError} from './errors';
import {atomicWrite,privateDirectory,readOptional} from './files';
interface SavedConflict {path:string;code:string;details:unknown}
interface ConflictState {version:1;conflicts:Record<string,SavedConflict>}
const file=(root:string)=>join(root,'.artifactbin','conflicts.json');
export async function readConflicts(root:string):Promise<ConflictState['conflicts']>{
 const raw=await readOptional(file(root));if(!raw)return {};
 let state:ConflictState;try{state=JSON.parse(raw.toString());}catch{throw new CliError('invalid_journal','The saved conflict state is invalid.');}
 if(state.version!==1||!state.conflicts||typeof state.conflicts!=='object'||Array.isArray(state.conflicts)||Object.entries(state.conflicts).some(([id,value])=>!ARTIFACT_ID_PATTERN.test(id)||!value||typeof value.path!=='string'))throw new CliError('invalid_journal','The saved conflict state is invalid.');
 return state.conflicts;
}
async function writeConflicts(root:string,conflicts:ConflictState['conflicts']){
 await privateDirectory(join(root,'.artifactbin'));await atomicWrite(file(root),JSON.stringify({version:1,conflicts}));
}
async function archive(root:string,id:string,conflict:SavedConflict){
 const directory=join(root,'.artifactbin','resolved-conflicts');await privateDirectory(directory);
 await atomicWrite(join(directory,`${id}-${randomUUID()}.json`),JSON.stringify(conflict),{exclusive:true});
}
export async function persistConflict(root:string,id:string,path:string,error:CliError):Promise<CliError>{
 if(!ARTIFACT_ID_PATTERN.test(id))throw new CliError('invalid_response','The conflict does not identify an artifact.');
 const conflicts=await readConflicts(root);if(conflicts[id])await archive(root,id,conflicts[id]);
 conflicts[id]={path,code:error.code,details:error.details};await writeConflicts(root,conflicts);
 return new CliError(error.code,error.message,'Both proposals are saved in .artifactbin/conflicts.json. Resolve the working file and use push --force to accept it, or pull --force to accept remote content.',{...(error.details&&typeof error.details==='object'?error.details:{}),conflict_file:file(root)},error.exitCode);
}
export async function clearConflict(root:string,id:string){
 const conflicts=await readConflicts(root);if(!conflicts[id])return;
 await archive(root,id,conflicts[id]);delete conflicts[id];await writeConflicts(root,conflicts);
}
