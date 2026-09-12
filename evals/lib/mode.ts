/**
 * Two flows of one product surface, the CLI.
 *
 * `installed`: afbin is on PATH and has been RUN — the driver executes `afbin auth` in the run home
 * before the agent starts, approving the browser pairing as the person would (`lib/approver.ts`), so
 * the CLI itself saved the account connection and eager init installed the skills where the harness looks.
 *
 * `not-installed`: nothing exists until the agent acts. No afbin on PATH, no skills, no connection.
 * The agent must find the installer from the server (homepage or llms.txt), run it, and run any server
 * command, whose first-use `afbin auth`; the driver approves that pairing too. The task proxy serves the installer and the
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
/** The driver stages afbin on PATH and runs its auth before the agent starts. */
export function cliPreinstalled(mode:EvalMode):boolean{return mode==='installed';}
export interface TransportPlan {run:ActionTransport;asked:ActionTransport;substitutedWhy:null}
export function planTransport(_harness:Harness,asked:ActionTransport):TransportPlan{return {asked,run:asked,substitutedWhy:null};}
/**
 * Is the protocol VOCABULARY on the agent's disk rather than fetched over the wire? Since the CLI became
 * the only surface (#108/#109) the answer is yes in every mode: the installed flow stages the skills, and
 * the not-installed flow's installer writes them (`~/.claude/skills`, `~/skills`, …) and `afbin help`
 * prints them from the bundle. No agent fetched `/docs` or `/llms.txt` in any of the 12 Sep runs, so a
 * ledger-only `read_docs_before_write` gate failed every deck, report and scrolly in not-installed mode
 * (run 34704052816: 12 of 13 failures) — it graded the product's design, not the agent. Recorded still;
 * gating never.
 */
export function vocabularyInstalled(_mode:EvalMode):boolean{return true;}
