/**
 * Document discovery exposes the npm CLI and direct HTTP API; local edits need no remote API.
 *
 * Every page carries two head tags: a `<link rel="help">` to `/llms.txt` (titled by
 * `AGENT_HELP_TITLE`) and a `<meta name="afbin">` naming npm CLI installation and email-authenticated HTTP —
 * and repeats them as a comment that is the LAST thing before `</body>`, because a shell tool
 * that keeps the tail of a long page drops the whole head (inline CSS and bootstrap JSON come
 * first). A shared `/a/<id>` is the document page itself (served in place, no redirect), so a
 * fetch that does not follow redirects reads the same pointers, plus a `Link` header.
 * The served one-pager is `skills/artifactbin/llms.txt` with `[[ base ]]` filled in; its first
 * line is the blurb (`agentBlurb`) still used elsewhere. Read once per process; the file ships
 * in the image beside `skills/`.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import { escapeHtml } from '@artifactbin/utils/escape';
import {AGENT_HELP_TITLE,type AgentDiscovery} from './agent-discovery-tags';
export {AGENT_HELP_TITLE,agentDiscovery,agentDiscoveryHead,type AgentDiscovery} from './agent-discovery-tags';
const BASE_TAG='[[ base ]]';
let source:string|null=null;
function llmsSource():string{
 return source??=readFileSync(path.resolve(process.cwd(),'skills/artifactbin/llms.txt'),'utf8')+'\n'
  +['http-api','http-document-graph','http-authoring'].map(name=>readFileSync(path.resolve(process.cwd(),'skills/artifactbin/references/'+name+'.md'),'utf8').replace(/^---\n[\s\S]*?\n---\n/,'')).join('\n');
}
const origin=(base:string)=>base.replace(/\/$/,'');
/** The one sentence that says what artifactbin is: line 1 of llms.txt. */
export function agentBlurb():string{return llmsSource().split('\n')[0]!.trim();}
/** The served one-pager, on the caller's base. */
export function llmsText(base:string):string{return llmsSource().split(BASE_TAG).join(origin(base));}
/** The pointer again, as the page's last line: what a tail-keeping reader sees. */
export function agentDiscoveryTail(help:AgentDiscovery):string{
 return `<!-- ${AGENT_HELP_TITLE}: ${escapeHtml(help.url)}. ${escapeHtml(help.instruction)} -->`;
}
/** Inserted before the FINAL `</body>`; an author's own `</body>` text never wins. */
export function withAgentDiscoveryTail(html:string,help:AgentDiscovery):string{
 const at=html.lastIndexOf('</body>');
 return at<0?html:`${html.slice(0,at)}${agentDiscoveryTail(help)}${html.slice(at)}`;
}
