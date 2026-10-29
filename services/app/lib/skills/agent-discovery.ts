/** Browser-safe discovery copy shared by metadata and the welcome page. */
export const EMAIL_AUTHENTICATION_INSTRUCTION='If sign-in is required, reuse an email already provided; otherwise ask the user for their email.';
export const AUTHENTICATION_INSTRUCTION=`${EMAIL_AUTHENTICATION_INSTRUCTION} Do not invent an email.`;
export interface AgentDiscovery {url:string;instruction:string}
export const AGENT_HELP_TITLE='Agent guide: authentication, creation, editing, and operations';
export function agentDiscovery(base:string):AgentDiscovery{
 const o=base.replace(/\/$/,'');
 return {url:`${o}/llms.txt`,instruction:`Use the artifactbin author skill and HTTP API. Read ${o}/llms.txt, or download the skill at ${o}/skills/artifactbin.zip. ${EMAIL_AUTHENTICATION_INSTRUCTION}`};
}
