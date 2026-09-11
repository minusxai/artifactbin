import type {ShareEntry} from '@artifactbin/contracts';
import {createTwoFilesPatch} from 'diff';
import {type LocalDocument} from './document';
import {inspectWorkspace,type Snapshot,type Workspace} from './workspace';
export function snapshotDocument(snapshot:Snapshot):LocalDocument{
 return{metadata:{...(snapshot.shares!==undefined?{shares:snapshot.shares as ShareEntry[]}:{}),...(snapshot.description!==undefined?{description:snapshot.description as string|null}:{}),...(snapshot.colorMode!==undefined?{colorMode:snapshot.colorMode as 'light'|'dark'|null}:{}),id:snapshot.id,title:snapshot.title??null,theme:snapshot.theme??null,template:snapshot.template??null,
  ...(snapshot.visibility?{visibility:snapshot.visibility}:{}),link:snapshot.link_role??'viewer',folder:snapshot.parent_id??null,
  edit_id:snapshot.edit_id,head_version:snapshot.version,state:snapshot.state},body:snapshot.markup??''};
}
export async function localStatus(workspace:Workspace){
 return{remote:'last_observed',server:workspace.lock?.server??null,files:(await inspectWorkspace(workspace)).map(file=>({path:file.path,status:file.status,id:file.tracked?.id,version:(file.tracked?.observed??file.tracked?.snapshot)?.version,base_version:file.tracked?.snapshot.version,...(file.renamedFrom?{renamed_from:file.renamedFrom}:{})}))};
}
export async function localDiff(workspace:Workspace,paths?:string[]){
 const files=await inspectWorkspace(workspace,paths);
 return{remote:'last_observed',diffs:files.filter(file=>file.status!=='unchanged').map(file=>{
  const before=file.tracked?Buffer.from(file.tracked.baseline,'base64').toString():'';
  const after=file.bytes?.toString()??'';
  return{path:file.path,diff:file.document?createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,before,after,'last observed','working file',{context:3}):`Binary file ${file.path}: ${file.status}`};
 })};
}
