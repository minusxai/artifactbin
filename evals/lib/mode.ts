/**
 * Two flows of one product surface, the CLI.
 *
 * `installed`: afbin is on PATH and has been RUN — the driver executes `afbin setup` in the run home
 * before the agent starts, approving the browser pairing as the person would (`lib/approver.ts`), so
 * the CLI itself saved the account connection and installed the skills where the harness looks.
 *
 * `not-installed`: nothing exists until the agent acts. No afbin on PATH, no skills, no connection.
 * The agent must find the installer from the server (homepage or llms.txt), run it, and run
 * `afbin setup`; the driver approves that pairing too. The task proxy serves the installer and the
 * locally built release so the flow is measurable against this checkout (`lib/proxy.ts`).
 *
 * There is no plugin, MCP or separately staged skill treatment: skills only ever arrive through the CLI.
 */
import type {Harness} from './contracts';
export const EVAL_MODES=['installed','not-installed'] as const;
export type EvalMode=(typeof EVAL_MODES)[number];
export type ActionTransport='cli';
export const DEFAULT_MODE:EvalMode='installed';
export interface ModePlan {asked:EvalMode;run:EvalMode;substitutedWhy:null}
export function parseMode(raw:string):EvalMode{
 if(!(EVAL_MODES as readonly string[]).includes(raw))throw new Error(`unknown --mode "${raw}" — known: ${EVAL_MODES.join(', ')}`);
 return raw as EvalMode;
}
export function actionTransport(_mode:EvalMode):ActionTransport{return 'cli';}
export function planMode(_harness:Harness,asked:EvalMode):ModePlan{return {asked,run:asked,substitutedWhy:null};}
/** The driver stages afbin on PATH and runs its setup before the agent starts. */
export function cliPreinstalled(mode:EvalMode):boolean{return mode==='installed';}
export interface TransportPlan {run:ActionTransport;asked:ActionTransport;substitutedWhy:null}
export function planTransport(_harness:Harness,asked:ActionTransport):TransportPlan{return {asked,run:asked,substitutedWhy:null};}
