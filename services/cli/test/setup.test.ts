import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {CliError} from '../src/commands';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node-pty';


test('setup selects before writing, remembers opt-outs and groups installed skills and restarts',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-'));const bin=join(home,'bin');const out:string[]=[];
 try{
  await mkdir(bin);
  for(const name of ['claude','codex','pi'])await writeFile(join(bin,name),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const context={home,cwd:home,env:{PATH:bin},interactive:true,stdout:(s:string)=>out.push(s),stderr:(s:string)=>out.push(s),fetch:async()=>{throw new Error('setup must stay offline');}};
  assert.equal(await runCli(['setup'],{...context,chooseSkills:async choices=>{
   assert.deepEqual(choices.filter(c=>c.selected).map(c=>c.name),['claude','codex','pi']);
   await assert.rejects(stat(join(home,'.claude','skills','artifactbin')),{code:'ENOENT'});
   return ['claude','codex'];
  }}),0,out.join(''));
  const text=out.join('');
  assert.match(text,/  Agent skills\n/);
  assert.match(text,/    .*Claude Code\s+~\/\.claude\/skills\/artifactbin/);
  assert.match(text,/    .*Codex\s+~\/\.codex\/skills\/artifactbin/);
  assert.equal((text.match(/Restart /g)??[]).length,1);
  assert.match(text,/Restart Claude Code and Codex to load your new skills\./);
  await assert.rejects(stat(join(home,'.pi','agent','skills','artifactbin')),{code:'ENOENT'});
  out.length=0;
  assert.equal(await runCli(['help','--json'],context),0);
  await assert.rejects(stat(join(home,'.pi','agent','skills','artifactbin')),{code:'ENOENT'});
  out.length=0;
  assert.equal(await runCli(['setup','--yes','--json'],{...context,chooseSkills:async()=>{throw new Error('must not prompt');}}),0);
  assert.ok(JSON.parse(out.join('')).installations.every((i:{status:string})=>i.status==='unchanged'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup cancellation writes nothing; selecting none persists even with detected agents',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-cancel-'));const out:string[]=[];
 try{
  const context={home,cwd:home,env:{PATH:''},interactive:true,stdout:(s:string)=>out.push(s),stderr:(s:string)=>out.push(s)};
  assert.equal(await runCli(['setup'],{...context,chooseSkills:async()=>{throw new CliError('cancelled','Skill installation cancelled.');}}),2);
  await assert.rejects(stat(join(home,'.artifactbin','settings.json')),{code:'ENOENT'});
  out.length=0;
  assert.equal(await runCli(['setup','--harness','none'],context),0,out.join(''));
  assert.match(out.join(''),/No skills selected/);
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin','settings.json'),'utf8')).harnesses,[]);
 }finally{await rm(home,{recursive:true,force:true});}
});

describe('the first local command', () => {
  const require=createRequire(import.meta.url);
  const main=fileURLToPath(new URL('../src/main.ts',import.meta.url));
  /**
   * INIT is eager on every command: a local `afbin help` in a real terminal installs the skill for the
   * detected harness without prompting or reaching the network, then prints the human overview
   * (automation and `afbin help brief` get the brief).
   */
  test('a local command installs the detected skill offline and prints the overview',{timeout:20000},async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-init-'));const bin=join(home,'bin');
   try{
    await mkdir(bin);await writeFile(join(bin,'pi'),'#!/bin/sh\nexit 1\n',{mode:0o755});
    const output=await new Promise<string>((resolve,reject)=>{
     const child=spawn(process.env.AFBIN_TEST_BINARY??process.execPath,[...(process.env.AFBIN_TEST_BINARY?[]:['--import',require.resolve('tsx'),main]),'help'],{cwd:home,cols:180,rows:30,env:{HOME:home,PATH:bin,TSX_TSCONFIG_PATH:fileURLToPath(new URL('../../../tsconfig.json',import.meta.url)),TERM:'xterm-256color'}});
     let text='';const timeout=setTimeout(()=>{child.kill();reject(new Error('help timed out: '+text));},15000);
     child.onData(data=>{text+=data;});
     child.onExit(event=>{clearTimeout(timeout);try{assert.equal(event.exitCode,0,text);resolve(text);}catch(error){reject(error);}});
    });
    // The coloured overview printed for the terminal, and no interactive checklist ever appeared.
    const plain=output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');
    assert.match(output,/\x1b\[/);
    assert.match(plain,/^afbin \d+\.\d+\.\d+\r?$/m);
    assert.match(plain,/^Usage: afbin <command>/m);
    assert.match(plain,/^Local files:/m);
    assert.doesNotMatch(plain,/## Read first/);
    assert.match(plain,/Skill installed: /);
    assert.doesNotMatch(output,/Install\/update local artifactbin skills|Choose an installed agent/);
    // The detected harness' skill was installed eagerly, offline.
    assert.match(await readFile(join(home,'.pi','agent','skills','artifactbin','SKILL.md'),'utf8'),/name: artifactbin/);
   }finally{await rm(home,{recursive:true,force:true});}
  });
});
