/** Browser-safe discovery copy shared by metadata and the welcome page. */
import { buildNpmSetupCommand } from './setup-instructions';
export const EMAIL_AUTHENTICATION_INSTRUCTION='If there are no saved credentials, you must ask the user for their email to complete authentication.';
export const AUTHENTICATION_INSTRUCTION=`${EMAIL_AUTHENTICATION_INSTRUCTION} Do not invent an email.`;
export interface AgentDiscovery {url:string;instruction:string;cliInstruction:string}
export const AGENT_HELP_TITLE='Agent guide: authentication, creation, editing, and operations';
export function agentDiscovery(base:string):AgentDiscovery{
 const o=base.replace(/\/$/,'');
 return {url:`${o}/llms.txt`,
  instruction:`Use the HTTP API to authenticate, create, edit, and operate artifacts. Read /llms.txt for all details. Or download all skills at /skills/artifactbin.zip. You must ask the user for their email to complete authentication.`,
  cliInstruction:`If you have the artifactbin CLI installed, follow its artifactbin skill. To install and set up the CLI, run: ${buildNpmSetupCommand({serverOrigin:o})}`};
}
