import {normalizeOrigin} from '@artifactbin/contracts';

export interface SetupInstructionOptions {serverOrigin:string;groupHandle?:string;setDefault?:boolean;}
const quoted=(value:string,windows=false)=>`'${windows?value.replaceAll("'","''"):value.replaceAll("'",`'"'"'`)}'`;
export function setupSelectionFlags(options:{groupHandle?:string;setDefault?:boolean},windows=false):string{
 return `${options.groupHandle?` --group ${quoted(options.groupHandle,windows)}`:''}${options.setDefault?' --set-default':''}`;
}
export function buildSetupCommand(options:SetupInstructionOptions,windows=false):string{
 const origin=normalizeOrigin(options.serverOrigin);if(!origin)throw new Error('Setup instructions require a server origin.');
 return `afbin setup --server ${quoted(origin,windows)}${setupSelectionFlags({...options,setDefault:options.setDefault??!!options.groupHandle},windows)}`;
}
/** Tokenless instructions for both deployment setup and group invitations. Browser-safe. */
export function buildSetupInstructions(options:SetupInstructionOptions):string{
 const origin=normalizeOrigin(options.serverOrigin);
 if(!origin)throw new Error('Setup instructions require a server origin.');
 if(options.groupHandle&&!/^[a-z0-9][a-z0-9_-]*$/i.test(options.groupHandle))throw new Error('Setup instructions require a group handle.');
 const group=options.groupHandle;
 const selectDefault=options.setDefault??!!group;
 const command=buildSetupCommand({...options,serverOrigin:origin,setDefault:selectDefault});
 return `Set up artifactbin for ${origin}${group?` and group ${group}`:''}. Read ${origin}/getting-started.md and use the artifactbin skill for this origin; reuse an installed skill and existing origin-scoped credentials.

Use an installed runnable CLI: ${command}. For this requested setup, if afbin is missing, run ${command.replace(/^afbin /,'npx --yes @afbin/cli@latest ')} (PowerShell: npx.cmd in place of npx), then restart your coding agent to load the skill. Ordinary setup is auth-free; explicit group/default selection authenticates you first.

Without CLI installation, use authenticated HTTP from ${origin}/llms/http-auth: reuse the shared credential helper, otherwise ask for your actual email, send the OTP and wait for your code. ${group?`GET /api/groups/${encodeURIComponent(group)} and verify your membership. ${selectDefault?'PUT /api/me/preferences with {"default_destination":{"type":"group","id":"<resolved group.id>"}}. ':''}`:selectDefault?'GET /api/me/preferences to verify your account. ':''}HTTP preferences belong to this account on this origin; local CLI host selection requires the CLI setup command or explicit client configuration.

Authenticate as the recipient; the sender’s login is never transferred. ${group?'Editors can publish and edit group artifacts; viewers can select the group and read permitted artifacts. ':''}New artifacts use an explicit destination, otherwise their parent’s owner, then your account default, then the deployment default, then Personal. Conflicting explicit destination and parent ownership is refused. Select Personal explicitly to override a deployment group, or inherit to clear the account override. Changing a default never transfers existing artifacts. No token belongs in these instructions, URLs or copied files.`;
}
export function buildGroupSetupInstructions(options:{serverOrigin:string;groupHandle:string}):string{
 return buildSetupInstructions({...options,setDefault:true});
}
