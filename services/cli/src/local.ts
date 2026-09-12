import {readConflicts} from './conflict-state';
import type {ShareEntry} from '@artifactbin/contracts';
import {createTwoFilesPatch} from 'diff';
import {type LocalDocument} from './document';
import {baselineOf,inspectWorkspace,type LocalFile,type Snapshot,type Workspace} from './workspace';
import {readResourceSource} from './resource-file';
import {skillStatus} from './skill-install';
import {extname} from 'node:path';
export function snapshotDocument(snapshot:Snapshot):LocalDocument{
 return{metadata:{...(snapshot.shares!==undefined?{shares:snapshot.shares as ShareEntry[]}:{}),...(snapshot.description!==undefined?{description:snapshot.description as string|null}:{}),...(snapshot.colorMode!==undefined?{colorMode:snapshot.colorMode as 'light'|'dark'|null}:{}),id:snapshot.id,title:snapshot.title??null,theme:snapshot.theme??null,template:snapshot.template??null,
  ...(snapshot.visibility?{visibility:snapshot.visibility}:{}),link:snapshot.link_role??'viewer',folder:snapshot.parent_id??null,
  edit_id:snapshot.edit_id,head_version:snapshot.version,state:snapshot.state},body:snapshot.markup??''};
}
export async function localStatus(workspace:Workspace,paths?:string[],home?:string,env?:NodeJS.ProcessEnv){
 const conflicts=await readConflicts(workspace.home,workspace.root);
 return{remote:'last_observed',server:workspace.tracking?.server??null,files:(await inspectWorkspace(workspace,paths)).map(file=>({path:file.path,status:file.tracked&&conflicts[file.tracked.id]?'conflicted':file.status,id:file.tracked?.id??file.document?.metadata.id??file.resource?.id,version:(file.tracked?.observed??file.tracked?.snapshot)?.version,base_version:file.tracked?.snapshot.version,...(file.renamedFrom?{renamed_from:file.renamedFrom}:{})})),...(home!==undefined?{skills:await skillStatus(home,env)}:{})};
}
export async function localDiff(workspace:Workspace,paths?:string[]){
 const files=await inspectWorkspace(workspace,paths);
 const diffs:Array<{path:string;diff:string;resource?:string}>=[];
 for(const file of files.filter(file=>file.status!=='unchanged')){
  const before=file.tracked?(await baselineOf(workspace,file.path,file.tracked))?.toString()??'':'';
  const after=file.bytes?.toString()??'';
  if(before!==after)diffs.push({path:file.path,diff:file.document||file.resource?createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,before,after,'last observed','working file',{context:3}):`Binary file ${file.path}: ${file.status}`});
  const source=await localSourceDiff(workspace,file);if(source)diffs.push(source);
 }
 return{remote:'last_observed',diffs};
}
export async function localSourceDiff(workspace:Workspace,file:LocalFile){
 if(!file.resource)return;
 const source=await readResourceSource(file.resource,file.path,workspace.root);if(!source||source.bytes===file.tracked?.source?.bytes)return;
 const before=Buffer.from(file.tracked?.source?.bytes??'','base64').toString(),after=Buffer.from(source.bytes,'base64').toString();
 const text=['.csv','.json','.jsx'].includes(extname(source.path).toLowerCase());
 return{path:source.path,resource:file.path,diff:text?createTwoFilesPatch(`base/${source.path}`,`local/${source.path}`,before,after,'last observed','working file',{context:3}):`Binary file ${source.path} differs`};
}
