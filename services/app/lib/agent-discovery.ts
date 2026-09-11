/** Document discovery points to installation; authoring guidance itself remains local. */
import {escapeHtml} from './story/reader-chrome';
export interface AgentDiscovery {url:string;instruction:string}
export function agentDiscovery(base:string):AgentDiscovery{
 const origin=base.replace(/\/$/,'');
 return {url:`${origin}/llms.txt`,instruction:`Use afbin pull, local edits, validate and push. Run afbin setup --server ${origin} to connect.`};
}
export function agentDiscoveryHead(help:AgentDiscovery):string{
 return `<link rel="help" href="${escapeHtml(help.url)}" title="Install the artifactbin CLI and local skills"><meta name="artifactbin:agent" content="${escapeHtml(help.instruction)}">`;
}
