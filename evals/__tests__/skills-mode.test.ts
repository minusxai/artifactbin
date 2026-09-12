/** Skills reach each harness only through the CLI's eager init; the eval knows where that lands and nothing more. */
import {expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {skillKit,harnessEnv,copySkillsInto} from '../lib/skill-kit';
import {rewriteInstallerForLocal} from '../lib/proxy';
import {adapterFor} from '../lib/harness';
import {planMode} from '../lib/mode';
import {buildPrompt} from '../lib/tasks';
import type {Harness,HarnessRunContext,Task} from '../lib/contracts';
import {skillTargets} from '../../services/cli/src/skill-install';
const ctx=(harness:Harness,home:string,installed:boolean):HarnessRunContext=>({leg:{harness,model:'m',envVar:'TEST_KEY',apiKey:'k',label:harness,price:null,vision:true,promptLevel:'starter',mode:planMode(harness,installed?'installed':'not-installed')},prompt:'p',cwd:home,homeDir:home,apiKey:'k',maxTurns:1,maxBudgetUsd:1,...(installed?{skills:skillKit(home,harness)}:{})});
it('names the directory eager init installs to for each harness, under the environment the adapter passes',()=>{
 const home='/tmp/afbin-home';const map={'claude-code':'claude',codex:'codex',pi:'pi',opencode:'opencode'} as const;
 for(const h of ['claude-code','codex','pi','opencode'] as const)expect(skillKit(home,h).dir).toBe(skillTargets(home,harnessEnv(h,home))[map[h]]);
 expect(adapterFor('pi').invocation(ctx('pi',home,true)).argv).toContain(skillKit(home,'pi').dir);
 expect(adapterFor('pi').invocation(ctx('pi',home,false)).argv).toContain('--no-skills');
 for(const name of ['claude-code','codex','pi','opencode'] as const)expect(JSON.stringify(adapterFor(name).invocation(ctx(name,home,true)))).not.toMatch(/plugin|ARTIFACTBIN_MCP_TOKEN/i);
});
it('copies an installed skill directory for OpenCode and copies nothing when setup has not run',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'afbin-skills-'));
 try{
  const kit=skillKit(root,'opencode');
  expect(copySkillsInto(kit,path.join(root,'project'))).toBeNull();
  fs.mkdirSync(kit.dir,{recursive:true});fs.writeFileSync(path.join(kit.dir,'SKILL.md'),'# skill');
  const dest=copySkillsInto(kit,path.join(root,'project'));
  expect(fs.readFileSync(path.join(dest!,'artifactbin/SKILL.md'),'utf8')).toBe('# skill');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('serves the checkout release through the installer without the https-only flags',()=>{
 const installer=fs.readFileSync(new URL('../../services/app/public/chat/install.sh',import.meta.url),'utf8');
 const local=rewriteInstallerForLocal(installer,'https://github.com/minusxai/artifactbin/releases/download/afbin-v','http://127.0.0.1:1234/chat/releases/afbin-v');
 expect(local).toContain('release="http://127.0.0.1:1234/chat/releases/afbin-v$version"');
 expect(local).not.toContain("--proto '=https'");
 expect(local).toContain('Checksum verification failed');
});
it('gives both CLI-staging flows the same prompt: mode is not an input to buildPrompt',()=>{
 // `installed` and `not-installed` differ only in how the driver stages the CLI; the agent reads the
 // identical starter text either way. buildPrompt takes no mode, so this is the one starter prompt.
 const task={id:'t',brief:'Publish it.',handoff:'cli',checks:[]} as unknown as Task;
 const access={kind:'token',base:'http://127.0.0.1:1',token:'x',id:'abc123'} as const;
 const p=buildPrompt(task,access,{promptLevel:'starter'});
 expect(p).toBe(buildPrompt(task,access));
 expect(p).toContain('afbin');
 expect(p).toContain('curl -fsSL http://127.0.0.1:1/chat/install.sh | sh');
 expect(p).toContain('Run afbin help first');
 expect(p).toContain('http://127.0.0.1:1/a/abc123');
 expect(p).not.toMatch(/\.env|afbin setup/);
});
