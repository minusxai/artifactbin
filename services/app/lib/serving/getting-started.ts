import type {DeploymentState} from '@artifactbin/contracts';
import {buildSetupInstructions} from '../platform/setup-instructions';

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
   {kind:'text',text:`Reuse an installed artifactbin skill for ${origin}. Otherwise download ${origin}/skills/artifactbin.zip and extract its artifactbin/ folder into your harness skill directory. Restart the harness so it loads SKILL.md. Without filesystem access, read ${origin}/llms.txt and its topic links.`},
   {kind:'command',label:'Download skill',language:'sh',text:`curl -fsSL '${origin}/skills/artifactbin.zip' -o artifactbin.zip`},
   {kind:'text',text:'Codex uses ~/.agents/skills; Claude Code uses ~/.claude/skills; Pi uses ~/.pi/agent/skills; OpenCode uses ~/.config/opencode/skills. Inspect existing project, shared and symlink locations first. Reuse an existing skill; choose the directory your harness loads and extract only when artifactbin is absent.'},
   {kind:'command',label:'Extract into chosen skill directory',language:'sh',text:'unzip -n artifactbin.zip -d "$SKILL_DIRECTORY"'},
   {kind:'text',text:'Windows: download the same ZIP and use Expand-Archive into a new empty directory; move artifactbin into your harness skill directory only if that location is absent. A ZIP download alone does not load a skill.'},
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
