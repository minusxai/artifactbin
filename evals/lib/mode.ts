/** One treatment: the released CLI and its installed local skill bundle. */
import type {Harness} from './contracts';
export const EVAL_MODES=['cli'] as const;
export type EvalMode=(typeof EVAL_MODES)[number];
export type SkillSource='installed_skill';
export type ActionTransport='cli';
export const DEFAULT_MODE:EvalMode='cli';
export interface ModePlan {asked:EvalMode;run:EvalMode;substitutedWhy:null}
export function parseMode(raw:string):EvalMode{
 if(raw!=='cli')throw new Error(`unknown --mode "${raw}" — known: cli`);
 return raw;
}
export function skillSource(_mode:EvalMode):SkillSource{return 'installed_skill';}
export function actionTransport(_mode:EvalMode):ActionTransport{return 'cli';}
export function modeFor(_source:SkillSource,_actions:ActionTransport):EvalMode{return 'cli';}
export function planMode(_harness:Harness,asked:EvalMode):ModePlan{return {asked,run:asked,substitutedWhy:null};}
export function installsSkills(_mode:EvalMode):boolean{return true;}
export interface TransportPlan {run:ActionTransport;asked:ActionTransport;substitutedWhy:null}
export function planTransport(_harness:Harness,asked:ActionTransport):TransportPlan{return {asked,run:asked,substitutedWhy:null};}
