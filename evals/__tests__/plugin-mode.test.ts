/** Harness discovery sees the release bundle without connecting an artifact server. */
import {afterAll,beforeAll,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {materializePlugin,copySkillsInto,type PluginKit} from '../lib/plugin-kit';
import {adapterFor} from '../lib/harness';
import {planMode} from '../lib/mode';
import type {Harness,HarnessRunContext} from '../lib/contracts';
import teaching from '../../services/cli/src/generated/teaching.json';
let root:string,kit:PluginKit;
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'afbin-local-skills-'));kit=materializePlugin(path.join(root,'bundle'),'https://example.test');});
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
const ctx=(harness:Harness):HarnessRunContext=>({leg:{harness,model:'m',envVar:'TEST_KEY',apiKey:'k',label:harness,price:null,vision:true,mode:planMode(harness,'cli')},prompt:'Use afbin',cwd:root,homeDir:path.join(root,'home'),apiKey:'k',maxTurns:5,maxBudgetUsd:1,plugin:kit});
it('stages every released local skill file, with no remote server config',()=>{
 expect(fs.existsSync(path.join(kit.pluginDir,'.mcp.json'))).toBe(false);
 for(const [name,text] of Object.entries(teaching.files))expect(fs.readFileSync(path.join(kit.skillDirs[0],name),'utf8')).toBe(text);
 expect(fs.existsSync(path.join(kit.marketplaceDir,'.claude-plugin/marketplace.json'))).toBe(true);
});
it('uses supported local discovery in each harness',()=>{
 expect(adapterFor('claude-code').invocation(ctx('claude-code')).argv).toContain(kit.pluginDir);
 expect(adapterFor('pi').invocation(ctx('pi')).argv).toContain(kit.skillDirs[0]);
 const dest=copySkillsInto(kit,path.join(root,'project'));
 expect(fs.readFileSync(path.join(dest,'artifactbin/SKILL.md'),'utf8')).toBe(teaching.files['SKILL.md']);
 for(const name of ['codex','opencode'] as const)expect(JSON.stringify(adapterFor(name).invocation(ctx(name)))).not.toContain('ARTIFACTBIN_MCP_TOKEN');
});
