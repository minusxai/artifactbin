/** Test-only view of the CLI's store: what a workspace root has registered and tracked. */
import {realpath} from 'node:fs/promises';
import {State} from '../src/state';
import type {StateKind} from '../src/state';
import type {TrackedFile,WorkspaceTracking} from '../src/workspace';

export async function tracking(home:string,root:string):Promise<{workspace:{server:string;account:string}|null;files:Record<string,TrackedFile>}>{
 const scope=await realpath(root);
 const state=await State.open(home);
 try{
  return{
   workspace:state.get<WorkspaceTracking>(scope,'workspace',scope)?.value??null,
   files:Object.fromEntries(state.list<TrackedFile>(scope,'tracked').map(record=>[record.key,record.value])),
  };
 }finally{state.close();}
}

export async function readRecord<T>(home:string,root:string,kind:StateKind,key:string):Promise<T|null>{
 const scope=await realpath(root);
 const state=await State.open(home);
 try{return state.get<T>(scope,kind,key)?.value??null;}finally{state.close();}
}

export async function writeRecord(home:string,root:string,kind:StateKind,key:string,value:unknown):Promise<void>{
 const scope=await realpath(root);
 const state=await State.open(home);
 try{state.put(scope,kind,key,value);}finally{state.close();}
}
