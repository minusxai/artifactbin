/**
 * The agent-discovery tags themselves — pure and node-free, so the offline
 * file (lib/offline/file-html, which also runs in the browser for Save) writes
 * the same `<head>` pointer every served page carries. lib/agent-discovery
 * re-exports these beside the parts that read llms.txt from disk.
 */
/** `url` is the help link (the one-pager); `instruction` is the afbin meta content, on the caller's base. */
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: read this to create, edit, or operate artifacts on the CLI using afbin';
/** Text and quoted-attribute safe; the same four characters lib/story/reader-chrome escapes. */
const escapeHtml=(s:string):string=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const origin=(base:string)=>base.replace(/\/$/,'');
/** The CLI's one-line install on `base`. */
export const afbinInstallCommand=(base:string):string=>`curl -fsSL ${origin(base)}/chat/install.sh | sh`;
export function agentDiscovery(base:string):AgentDiscovery{
 const o=origin(base);
 return {url:`${o}/llms.txt`,instruction:`afbin: a CLI to operate artifacts. Install: ${afbinInstallCommand(o)}; Windows: /chat/install.ps1 (PowerShell)`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="${escapeHtml(help.instruction)}">`;
}
