/** The driver supplies local CLI access without exposing credentials in the prompt. */
import type {Task} from './contracts';
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
/**
 * The prompt SHAPE, independent of CLI staging (which is the `mode` axis).
 * `starter` teaches the afbin CLI and the installer, and carries the server and
 * document in a natural instruction — it is the SAME text whether the driver
 * pre-installed the CLI (`installed` mode) or the agent must install it
 * (`not-installed` mode). `hardcore` strips all of that: only the brief, the
 * vision note when relevant, and the bare base.
 */
export const PROMPT_LEVELS=['hardcore','starter'] as const;
export type PromptLevel=(typeof PROMPT_LEVELS)[number];
export const DEFAULT_PROMPT_LEVEL:PromptLevel='starter';
export function parsePromptLevel(raw:string):PromptLevel{
 if(!(PROMPT_LEVELS as readonly string[]).includes(raw))throw new Error(`unknown --prompt "${raw}" — known: ${PROMPT_LEVELS.join(', ')}`);
 return raw as PromptLevel;
}
export interface PromptOptions {vision?:boolean;promptLevel?:PromptLevel}
const VISION_LINE='You cannot view images. Check your work by reading the document markup.';
export function buildPrompt(task:Task,access:Access,opts:PromptOptions={}):string{
 const level=opts.promptLevel??DEFAULT_PROMPT_LEVEL;
 const vision=opts.vision===false?[VISION_LINE]:[];
 if(level==='hardcore'){
  // Hardcore gives ONLY the base — never the artifact id, the installer or afbin.
  // `start-link` carries its base inside the product's copy-text handoff (with the
  // raw token), so there is no base field to hand over bare; the harness never
  // produces that combination, and emitting the handoff here would leak the token.
  if(access.kind==='start-link')throw new Error('hardcore prompts are not defined for the start-link handoff');
  return [task.brief,...vision,`Use ${access.base}.`].join('\n\n');
 }
 const head=access.kind==='start-link'
  ? access.startPrompt
  : access.kind==='token'
   ? `Help me edit my artifact at ${access.base}/a/${access.id}. Use the afbin CLI to operate artifactbin, or (curl -fsSL ${access.base}/chat/install.sh | sh) if not installed. Run afbin help first.`
   : `I want to publish to artifactbin at ${access.base}. Use the afbin CLI to operate artifactbin, or (curl -fsSL ${access.base}/chat/install.sh | sh) if not installed. Run afbin help first.`;
 return [head,task.brief,...vision].join('\n\n');
}
