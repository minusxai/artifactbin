import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { escapeHtml } from '@artifactbin/utils/escape';
/**
 * The agent-discovery tags themselves — pure and node-free, so the offline
 * file (lib/offline/file-html, which also runs in the browser for Save) writes
 * the same `<head>` pointer every served page carries. lib/agent-discovery
 * re-exports these beside the parts that read llms.txt from disk.
 */
/** `url` is the help link (the one-pager); `instruction` is the CLI/HTTP discovery meta content, on the caller's base. */
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API';
const origin=(base:string)=>base.replace(/\/$/,'');
/** Shell quoting is platform-specific; keep even a supplied origin one argument. */
const quoted=(value:string,windows=false):string=>`'${windows?value.replaceAll("'","''"):value.replaceAll("'",`'"'"'`)}'`;
export const afbinServerFlag=(base:string,windows=false):string=>origin(base)===DEFAULT_SERVER?'':` --server ${quoted(origin(base),windows)}`;
/** Prepare Node in this terminal, then install skills for the selected server. */
export const afbinInstallCommand=(base:string):string=>`afbin_node_setup="$(mktemp)" && curl -fsSL ${quoted(`${origin(base)}/chat/ensure-node.sh`)} -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"\nnpx --yes @afbin/cli@latest setup${afbinServerFlag(base)}`;
/** PowerShell uses .cmd to work under its default script execution policy. */
export const afbinWindowsInstallCommand=(base:string):string=>`Invoke-RestMethod ${quoted(`${origin(base)}/chat/ensure-node.ps1`,true)} | Invoke-Expression\nnpx.cmd --yes @afbin/cli@latest setup${afbinServerFlag(base,true)}`;
export function agentDiscovery(base:string):AgentDiscovery{
 const o=origin(base);
 return {url:`${o}/llms.txt`,instruction:`afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="${escapeHtml(help.instruction)}">`;
}
