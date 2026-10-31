import type {DeploymentState} from '@artifactbin/contracts';
import { buildSetupInstructions } from '../skills/setup-instructions';

type GuideBlock =
 | {kind:'text';text:string}
 | {kind:'command';label:string;language:'sh'|'powershell';text:string};
export interface GettingStartedGuide {
 title:string;intro:string;
 sections:Array<{id:string;title:string;blocks:GuideBlock[]}>;
}
/** One author skill, addressed to this server; authentication stays in the HTTP guide. */
export function gettingStarted(base:string,deployment?:DeploymentState):GettingStartedGuide {
 const origin=base.replace(/\/+$/,'');
 const sections:GettingStartedGuide['sections']=[
  {id:'skill',title:'Add the author skill',blocks:[
   {kind:'text',text:`Install the artifactbin skill with the three shell lines in https://artifactbin.dev/install.sh: read that plain-text script, then run its lines yourself, replacing https://app.artifactbin.dev/skills/artifactbin.zip with ${origin}/skills/artifactbin.zip. They download the archive, extract an immutable release and link one shared skill into installed harness directories. Inspect existing skills and symlinks first; back up stale copies instead of overlaying them. Without filesystem access, read ${origin}/llms.txt and its topic links.`},
   {kind:'text',text:'Codex reads ~/.agents/skills/artifactbin. Claude Code, Pi and OpenCode use symlinks to that same path. Other harnesses must use their documented skill directory. Reload skills after installation or an update; an existing session may retain old instructions.'},
   {kind:'command',label:'Inspect the current release',language:'sh',text:`curl -fsSL '${origin}/skills/artifactbin/latest.json'`},
   {kind:'text',text:'From a managed installation’s artifactbin folder, run node scripts/update.mjs to update. Commands also check in the background; --no-update or ARTIFACTBIN__NO_UPDATE=1 opts out. Read the reported SKILL.md after an update. A legacy extracted copy without an updater needs the fresh-install recipe, not an overlay.'},
   {kind:'text',text:`Windows: download ${origin}/skills/artifactbin.zip and use Expand-Archive into a new empty directory, then copy the artifactbin folder into your harness skill directory. This manual installation does not enable automatic updates. Use the managed shell recipe in WSL for the update flow. A ZIP download alone does not load a skill.`},
  ]},
  {id:'connect',title:'Connect your agent',blocks:[
   {kind:'text',text:`Ask your agent to use the artifactbin author skill. Read ${origin}/llms/http-auth for email sign-in and origin-scoped credential storage. Reuse existing credentials. Authenticate as the recipient: a shared link does not transfer the sender’s login or grant edit access.`},
  ]},
  {id:'author',title:'Create or edit through HTTP',blocks:[
   {kind:'text',text:`Read ${origin}/llms.txt for native HTML creation and editing with the skill's scripts. Preserve artifact identity when editing. Read ${origin}/llms/datasets for linked datasets, schema discovery and authorized reads and writes. Verify the published result and share its returned URL.`},
  ]},
 ];
 if(deployment?.mode==='company')sections.push({id:'deployment',title:'Use your deployment',blocks:[{kind:'text',text:buildSetupInstructions({serverOrigin:origin,...(deployment.setup_complete&&deployment.default_group?{groupHandle:deployment.default_group.handle,setDefault:true}:{})})}]});
 return {title:'Getting started',intro:'Use the artifactbin author skill and authenticated HTTP API to create and edit artifacts.',sections};
}
