/**
 * Document discovery exposes the npm CLI and direct HTTP API; local edits need no remote API.
 *
 * Every page carries two head tags: a `<link rel="help">` to `/llms.txt` (titled by
 * `AGENT_HELP_TITLE`) and a `<meta name="afbin">` naming npm CLI installation and email-authenticated HTTP —
 * and repeats them as a comment that is the LAST thing before `</body>`, because a shell tool
 * that keeps the tail of a long page drops the whole head (inline CSS and bootstrap JSON come
 * first). A shared `/a/<id>` is the document page itself (served in place, no redirect), so a
 * fetch that does not follow redirects reads the same pointers, plus a `Link` header.
 * Pure and node-free, so the offline file (lib/offline/file-html, which also runs in the browser
 * for Save) writes the same pointers every served page carries. The one-pager itself is read by
 * lib/serving/agent-discovery.
 */
import { escapeHtml } from '@artifactbin/utils/escape';
/** `url` is the help link (the one-pager); `instruction` is the CLI/HTTP discovery meta content, on the caller's base. */
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API';
const origin=(base:string)=>base.replace(/\/$/,'');
export function agentDiscovery(base:string):AgentDiscovery{
 const o=origin(base);
 return {url:`${o}/llms.txt`,instruction:`Use an installed afbin CLI, otherwise HTTP: reuse the artifactbin skill or read ${o}/llms.txt; optional skill ZIP: ${o}/skills/artifactbin.zip. CLI setup when requested: npx --yes @afbin/cli@latest setup --server ${JSON.stringify(o)} (Windows: npx.cmd). Authenticate as the recipient with artifact access. Local/offline editing needs no remote API.`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="${escapeHtml(help.instruction)}">`;
}
/** The pointer again, as the page's last line: what a tail-keeping reader sees. */
export function agentDiscoveryTail(help:AgentDiscovery):string{
 return `<!-- ${AGENT_HELP_TITLE}: ${escapeHtml(help.url)}. ${escapeHtml(help.instruction)} -->`;
}
/** Inserted before the FINAL `</body>`; an author's own `</body>` text never wins. */
export function withAgentDiscoveryTail(html:string,help:AgentDiscovery):string{
 const at=html.lastIndexOf('</body>');
 return at<0?html:`${html.slice(0,at)}${agentDiscoveryTail(help)}${html.slice(at)}`;
}
