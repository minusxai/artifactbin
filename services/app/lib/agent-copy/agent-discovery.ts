/** Shared HTTP discovery for page heads, tail-keeping readers and the visible welcome page.
 * Pure and browser-safe; the serving origin supplies every help/setup address. */
import { escapeHtml } from '@artifactbin/utils/escape';
import { AGENT_HELP_TITLE, type AgentDiscovery } from '../skills';
export { AGENT_HELP_TITLE, agentDiscovery, type AgentDiscovery } from '../skills';
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="agents" content="${escapeHtml(help.instruction)}">`;
}
/** First-paint app contract: one replaceable startup region, a named loading
 * status and a retry link that works without app JavaScript. Agent guidance is
 * confined to noscript; head and tail discovery remain available to agents. */
export function agentDiscoveryBody(help:AgentDiscovery):string{
 return `<main data-app-startup class="app-startup"><div class="app-startup-brand"><img src="/logo-128.png" alt="" width="28" height="28"><span>artifactbin</span></div><p role="status" aria-live="polite">Loading artifactbin…</p><p class="app-startup-retry">Taking a while? <a href="">Reload</a></p><noscript><p>Enable JavaScript to open artifactbin.</p><a href="${escapeHtml(help.url)}">${escapeHtml(AGENT_HELP_TITLE)}</a></noscript></main>`;
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
