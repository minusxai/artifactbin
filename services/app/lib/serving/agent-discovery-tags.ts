import { escapeHtml } from '@artifactbin/utils/escape';
/**
 * The agent-discovery tags themselves — pure and node-free, so the offline
 * file (lib/offline/file-html, which also runs in the browser for Save) writes
 * the same `<head>` pointer every served page carries. lib/agent-discovery
 * re-exports these beside the parts that read llms.txt from disk.
 */
/** `url` is the help link (the one-pager); `instruction` is the afbin meta content, on the caller's base. */
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: read this to create, edit, or operate artifacts on the CLI using afbin';
const origin=(base:string)=>base.replace(/\/$/,'');
/** The CLI's one-line install on `base`. */
export const afbinInstallCommand=(base:string):string=>`afbin_node_setup="$(mktemp)" && curl -fsSL ${origin(base)}/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"\nnpx --yes @artifactbin/cli@latest setup`;
/** PowerShell uses .cmd to work under its default script execution policy. */
export const afbinWindowsInstallCommand=(base:string):string=>`Invoke-RestMethod ${origin(base)}/chat/ensure-node.ps1 | Invoke-Expression\nnpx.cmd --yes @artifactbin/cli@latest setup`;
export function agentDiscovery(base:string):AgentDiscovery{
 const o=origin(base);
 return {url:`${o}/llms.txt`,instruction:`afbin: npx --yes @artifactbin/cli@latest. Node: /chat/ensure-node.sh; Windows: /chat/ensure-node.ps1`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="${escapeHtml(help.instruction)}">`;
}
