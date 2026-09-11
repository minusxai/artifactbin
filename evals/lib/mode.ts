/**
 * Two treatments of the same product surface, the CLI.
 *
 * `installed`: the CLI is on PATH, its local skill bundle is already in the harness's skill
 * directory and the account connection is saved in `~/.artifactbin/.env` before the agent starts.
 * This measures authoring with the guidance a set-up machine has.
 *
 * `cold`: the CLI is on PATH and nothing else is set up — no skills, no connection. The agent has to
 * run `afbin setup`, which opens browser approval and installs the skills; the driver approves the
 * pairing with its own session (`lib/approver.ts`) so the flow completes headlessly and the agent
 * never sees a token. Skills installed mid-run are on disk but not loaded by a harness that
 * discovers them at startup, which is exactly the situation the restart hint describes.
 */
import type {Harness} from './contracts';
export const EVAL_MODES=['installed','cold'] as const;
export type EvalMode=(typeof EVAL_MODES)[number];
export type SkillSource='installed_skill'|'none';
export type ActionTransport='cli';
export const DEFAULT_MODE:EvalMode='installed';
export interface ModePlan {asked:EvalMode;run:EvalMode;substitutedWhy:null}
export function parseMode(raw:string):EvalMode{
 if(!(EVAL_MODES as readonly string[]).includes(raw))throw new Error(`unknown --mode "${raw}" — known: ${EVAL_MODES.join(', ')}`);
 return raw as EvalMode;
}
export function skillSource(mode:EvalMode):SkillSource{return mode==='installed'?'installed_skill':'none';}
export function actionTransport(_mode:EvalMode):ActionTransport{return 'cli';}
export function modeFor(source:SkillSource,_actions:ActionTransport):EvalMode{return source==='installed_skill'?'installed':'cold';}
export function planMode(_harness:Harness,asked:EvalMode):ModePlan{return {asked,run:asked,substitutedWhy:null};}
/** The driver stages the skill bundle before the agent starts. */
export function installsSkills(mode:EvalMode):boolean{return mode==='installed';}
/** The driver writes the account connection before the agent starts. */
export function providesConnection(mode:EvalMode):boolean{return mode==='installed';}
export interface TransportPlan {run:ActionTransport;asked:ActionTransport;substitutedWhy:null}
export function planTransport(_harness:Harness,asked:ActionTransport):TransportPlan{return {asked,run:asked,substitutedWhy:null};}
