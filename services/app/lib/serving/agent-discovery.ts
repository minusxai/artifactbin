/** Shared HTTP discovery for page heads, tail-keeping readers and the visible welcome page.
 * Pure and browser-safe; the serving origin supplies every help/setup address. */
import { escapeHtml } from '@artifactbin/utils/escape';
import { AGENT_HELP_TITLE, type AgentDiscovery } from '../platform/agent-discovery';
export { AGENT_HELP_TITLE, agentDiscovery, type AgentDiscovery } from '../platform/agent-discovery';
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="agents" content="${escapeHtml(help.instruction)}">`;
}
/** Readable startup help, replaced when the app mounts. Padding keeps it below
 * the app bar and behind a server-drawn document frame during startup. */
export function agentDiscoveryBody(help:AgentDiscovery):string{
 return `<main data-app-startup class="px-6 pt-16"><a href="${escapeHtml(help.url)}">${escapeHtml(AGENT_HELP_TITLE)}</a></main>`;
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

/** Stable product blurb; authoring guidance is served from the shared skill root. */
export function agentBlurb():string{return 'artifactbin publishes native HTML pages, datasets and media.';}
