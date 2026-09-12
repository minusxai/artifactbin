import {expect,it,describe} from 'vitest';
import fs, {mkdtempSync,rmSync,statSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import os, {tmpdir} from 'node:os';
import path, {join} from 'node:path';
import {skillKit,harnessEnv,copySkillsInto} from '../lib/skill-kit';
import {rewriteInstallerForLocal} from '../lib/proxy';
import {adapterFor} from '../lib/harness';
import {planMode,DEFAULT_MODE,cliPreinstalled,parseMode} from '../lib/mode';
import {buildPrompt} from '../lib/tasks';
import type {Harness,HarnessRunContext,Task} from '../lib/contracts';
import {skillTargets} from '../../services/cli/src/skill-install';
import {execFileSync} from 'node:child_process';
import {materializeCli,stagedCliSource,platformBinary} from '../lib/cli-kit';
import {countDocsReads} from '../lib/docs-reads';

/** Skills reach each harness only through the CLI's eager init; the eval knows where that lands and nothing more. */
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
 const task={id:'t',brief:'Publish it.',checks:[]} as unknown as Task;
 const access={base:'http://127.0.0.1:1',id:'abc123'} as const;
 const p=buildPrompt(task,access,{promptLevel:'starter'});
 expect(p).toBe(buildPrompt(task,access));
 expect(p).toContain('afbin');
 expect(p).toContain('curl -fsSL http://127.0.0.1:1/chat/install.sh | sh');
 expect(p).toContain('Run afbin help first');
 expect(p).toContain('http://127.0.0.1:1/a/abc123');
 expect(p).not.toMatch(/\.env|afbin setup/);
});

describe('the run mode', () => {
  it('runs two CLI flows, installed and not-installed, without silent substitutions',()=>{
   expect(DEFAULT_MODE).toBe('installed');
   for(const harness of ['claude-code','codex','pi','opencode'] as const)for(const mode of ['installed','not-installed'] as const)expect(planMode(harness,parseMode(mode))).toEqual({asked:mode,run:mode,substitutedWhy:null});
   expect(cliPreinstalled('installed')).toBe(true);expect(cliPreinstalled('not-installed')).toBe(false);
   for(const mode of ['cli','cold','fetched_skill+api_action','installed_skill+mcp_action'])expect(()=>parseMode(mode)).toThrow('unknown --mode');
  });
});

describe('the CLI kit', () => {
  it('stages the actual CLI outside the checkout and runs offline without creating credentials',()=>{
   const root=mkdtempSync(join(tmpdir(),'afbin-eval-cli-'));
   try{
    const bin=materializeCli(join(root,'bin'));
    const output=execFileSync(join(bin,'afbin'),['--version','--json'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},encoding:'utf8'});
    expect(JSON.parse(output)).toMatchObject({protocol:1});
    expect(statSync(join(bin,'afbin')).mode&0o777).toBe(0o755);
    expect(existsSync(join(root,'.artifactbin'))).toBe(false);
    expect(()=>materializeCli(join(root,'missing'),join(root,'absent'))).toThrow('Build the CLI');
   }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('counts local CLI help as reading guidance without counting writes',()=>{
   expect(countDocsReads([{name:'bash',input:{command:'afbin help markup'}},{name:'bash',input:{command:'afbin push -h'}},{name:'bash',input:{command:'afbin push report.jsx'}}])).toBe(2);
  });
});

it('stages the platform binary when it exists — the .mjs cannot resolve DuckDB from a run home — and the bundle otherwise',()=>{
 const dist=mkdtempSync(join(tmpdir(),'afbin-eval-dist-'));
 try{
  mkdirSync(dist,{recursive:true});
  writeFileSync(join(dist,'afbin.mjs'),'// bundle');
  expect(stagedCliSource(dist)).toBe(join(dist,'afbin.mjs'));
  writeFileSync(platformBinary(dist),'#!/bin/sh\necho binary\n');
  expect(stagedCliSource(dist)).toBe(platformBinary(dist));
  const bin=materializeCli(join(dist,'bin'),stagedCliSource(dist));
  expect(execFileSync(join(bin,'afbin'),{encoding:'utf8'}).trim()).toBe('binary');
 }finally{rmSync(dist,{recursive:true,force:true});}
});
// Only where `build:binary` ran: the unit-test job builds the bundle alone, and the bundle is exactly the
// build that cannot resolve DuckDB from a run home — the eval workflows build the binary before a leg.
it.skipIf(!existsSync(platformBinary()))('the staged CLI can run a local-file query — the reason the binary is preferred',()=>{
 const root=mkdtempSync(join(tmpdir(),'afbin-eval-duck-'));
 try{
  const bin=materializeCli(join(root,'bin'));
  writeFileSync(join(root,'rows.csv'),'team,cups\neng,3\nops,4\n');
  writeFileSync(join(root,'q.sql'),'select sum(cups) as total from public.rows');
  const output=execFileSync(join(bin,'afbin'),['query','rows.csv','--input','q.sql','--json'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},encoding:'utf8'});
  expect(JSON.parse(output).results[0].rows[0]).toEqual({total:7});
 }finally{rmSync(root,{recursive:true,force:true});}
});
