/** The driver supplies local CLI access without exposing credentials in the prompt. */
import type {Task} from './contracts';
import type {EvalMode} from './mode';
export type Access=
 | {kind:'start-link';startPrompt:string}
 | {kind:'token';base:string;token:string;id:string}
 | {kind:'none';base:string};
export function tokenFromPaste(startPrompt:string):string{
 const token=/using this token: (mx_[A-Za-z0-9_-]+)/.exec(startPrompt)?.[1];
 if(!token)throw new Error('start paste carries no token');
 return token;
}
export function needsStartDocument(task:Task):boolean{return task.handoff!=='none';}
export interface StartDocument {id:string;prompt:string}
export interface AccessPlanInput {task:Task;base:string;start:StartDocument|null;credential:{token:string}|null}
export interface AccessPlan {access:Access;connectionToken:string|null;seed:{id:string;token:string;markup:string}|null}
export function planAccess({task,base,start,credential}:AccessPlanInput):AccessPlan{
 if(task.handoff==='none'){
  if(start)throw new Error(`${task.id} declares handoff: none — it must not be given a start document`);
  return {access:{kind:'none',base},connectionToken:null,seed:null};
 }
 if(!start)throw new Error(`${task.id} needs a start document for handoff: ${task.handoff}`);
 const token=credential?.token??tokenFromPaste(start.prompt);
 return {access:{kind:'token',base,token,id:start.id},connectionToken:token,seed:task.seed===undefined?null:{id:start.id,token,markup:task.seed}};
}
export interface PromptOptions {vision?:boolean;mode?:EvalMode}
export function buildPrompt(task:Task,access:Access,opts:PromptOptions={}):string{
 const parts=[task.brief];
 if(opts.vision===false)parts.push('You cannot view images. Check your work by reading the document markup.');
 if(access.kind==='start-link')parts.push(access.startPrompt);
 else{
  parts.push(`Use afbin and the installed artifactbin skill. The server is ${access.base}. Read afbin help for local command and authoring guidance.`);
  if(access.kind==='token')parts.push(`The connection is saved in ~/.artifactbin/.env. Work on artifact ${access.id} with afbin pull, local edits, afbin validate and afbin push.`);
  else parts.push('You have not been given a token or a document.');
 }
 return parts.join('\n\n');
}
