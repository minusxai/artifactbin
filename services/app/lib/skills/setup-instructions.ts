import {normalizeOrigin} from '@artifactbin/contracts';

export interface SetupInstructionOptions {serverOrigin:string;groupHandle?:string;setDefault?:boolean;}
/** Tokenless instructions for both deployment setup and group invitations. Browser-safe. */
export function buildSetupInstructions(options:SetupInstructionOptions):string{
 const origin=normalizeOrigin(options.serverOrigin);
 if(!origin)throw new Error('Setup instructions require a server origin.');
 if(options.groupHandle&&!/^[a-z0-9][a-z0-9_-]*$/i.test(options.groupHandle))throw new Error('Setup instructions require a group handle.');
 const group=options.groupHandle;
 const selectDefault=options.setDefault??!!group;
 return `Set up artifactbin for ${origin}${group?` and group ${group}`:''}. Read ${origin}/llms.txt and use the artifactbin author skill for this origin; reuse existing origin-scoped credentials. Check the installed skill’s origin and release before reusing it. Install with the three lines in https://artifactbin.dev/install.sh, using ${origin}/skills/artifactbin.zip as the archive URL; ${origin}/getting-started.md covers updates. Reload the harness after installing or updating.

Use authenticated HTTP from ${origin}/llms/http-auth: reuse saved credentials, otherwise ask for your actual email, send the OTP and wait for your code. ${group?`GET /api/groups/${encodeURIComponent(group)} and verify your membership. ${selectDefault?'PUT /api/me/preferences with {"default_destination":{"type":"group","id":"<resolved group.id>"}}. ':''}`:selectDefault?'GET /api/me/preferences to verify your account. ':''}Preferences belong to this account on this origin.

Authenticate as the recipient; the sender’s login is never transferred. ${group?'Editors can publish and edit group artifacts; viewers can select the group and read permitted artifacts. ':''}New artifacts use an explicit destination, otherwise their parent’s owner, then your account default, then the deployment default, then Personal. Conflicting explicit destination and parent ownership is refused. Select Personal explicitly to override a deployment group, or inherit to clear the account override. Changing a default never transfers existing artifacts. No token belongs in these instructions, URLs or copied files.`;
}
export function buildGroupSetupInstructions(options:{serverOrigin:string;groupHandle:string}):string{
 return buildSetupInstructions({...options,setDefault:true});
}
