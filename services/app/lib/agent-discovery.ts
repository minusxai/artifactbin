/**
 * Document discovery points an agent at installation; authoring guidance itself stays local.
 *
 * ONE source: `skills/artifactbin/llms.txt`, beside the brief. Its first line is the blurb every
 * discovery surface repeats — the `<meta name="artifactbin:agent">` on every page is that line plus
 * the guide address — and the whole file, with `[[ base ]]` filled in, is what `/llms.txt` serves.
 * Read once per process; the file ships in the image beside `skills/`.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {escapeHtml} from './story/reader-chrome';
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: read this first to create, edit or operate any artifact here';
const BASE_TAG='[[ base ]]';
let source:string|null=null;
function llmsSource():string{
 return source??=readFileSync(path.resolve(process.cwd(),'skills/artifactbin/llms.txt'),'utf8');
}
const origin=(base:string)=>base.replace(/\/$/,'');
/** The one sentence that says what artifactbin is: line 1 of llms.txt. */
export function agentBlurb():string{return llmsSource().split('\n')[0]!.trim();}
/** The served one-pager, on the caller's base. */
export function llmsText(base:string):string{return llmsSource().split(BASE_TAG).join(origin(base));}
export function agentDiscovery(base:string):AgentDiscovery{
 const guide=`${origin(base)}/llms.txt`;
 return {url:guide,instruction:`${agentBlurb()} Guide: ${guide}`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="artifactbin:agent" content="${escapeHtml(help.instruction)}">`;
}
