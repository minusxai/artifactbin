/**
 * Document discovery points an agent at the afbin CLI; authoring guidance itself stays local.
 *
 * Every page carries two head tags: a `<link rel="help">` to `/llms.txt` (titled by
 * `AGENT_HELP_TITLE`) and a `<meta name="afbin">` naming the CLI and its one-line install.
 * The served one-pager is `skills/artifactbin/llms.txt` with `[[ base ]]` filled in; its first
 * line is the blurb (`agentBlurb`) still used elsewhere. Read once per process; the file ships
 * in the image beside `skills/`.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {escapeHtml} from './story/reader-chrome';
/** `url` is the help link (the one-pager); `instruction` is the afbin meta content, on the caller's base. */
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: read this to create, edit, or operate artifacts on the CLI using afbin';
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
 const o=origin(base);
 return {url:`${o}/llms.txt`,instruction:`afbin: a CLI to operate artifacts. Install: curl -fsSL ${o}/chat/install.sh | sh`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="${escapeHtml(help.instruction)}">`;
}
