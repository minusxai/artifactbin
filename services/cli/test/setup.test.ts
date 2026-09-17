import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
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
  const real=await realpath(home);
  assert.ok(text.includes(`Claude Code  ${real}/.claude/skills/artifactbin`),text);
  assert.ok(text.includes(`Codex        ${real}/.codex/skills/artifactbin`),text);
  assert.ok(!text.includes('~/'),text);
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

test('explicit SQL preparation checks the local engine and reports readiness without authentication',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-sql-'));const out:string[]=[];
 try{
  assert.equal(await runCli(['setup','--service','sql','--json'],{home,cwd:home,env:{},stdout:s=>out.push(s),stderr:s=>out.push(s),fetch:async()=>{throw new Error('no server authentication');}}),0,out.join(''));
  assert.deepEqual(JSON.parse(out.join('')),{services:[{name:'sql',status:'ready',execution:'local'}]});
  await assert.rejects(stat(join(home,'.artifactbin','settings.json')),{code:'ENOENT'});
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

test('eager init leaves a skill addressed to another server alone — every command used to rewrite it (127 "Skill updated" lines in one local task)',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-init-origin-'));const bin=join(home,'bin');const err:string[]=[];
 try{
  await mkdir(bin);await writeFile(join(bin,'pi'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const context={home,cwd:home,env:{PATH:bin},interactive:false,stdout:()=>{},stderr:(s:string)=>err.push(s),fetch:async()=>{throw new Error('init must stay offline');}};
  assert.equal(await runCli(['help','--json','--server','https://one.example'],context),0);
  assert.ok(err.join('').includes('Skill installed:'),err.join(''));
  const skill=join(home,'.pi','agent','skills','artifactbin','SKILL.md');const before=await stat(skill);
  err.length=0;
  assert.equal(await runCli(['help','--json','--server','https://two.example'],context),0);
  assert.equal(err.join(''),'','a second server must not rewrite the skill on every command');
  assert.equal((await stat(skill)).mtimeMs,before.mtimeMs);
  err.length=0;
  assert.equal(await runCli(['setup','--yes','--json','--server','https://two.example'],context),0,'setup is where a new origin is adopted');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup --server records a self-hosted origin as the default, once, and never the public server',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-origin-'));const bin=join(home,'bin');const out:string[]=[];
 try{
  await mkdir(bin);await writeFile(join(bin,'pi'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const context={home,cwd:home,env:{PATH:bin},interactive:false,stdout:(s:string)=>out.push(s),stderr:()=>{},fetch:async()=>{throw new Error('setup must stay offline');}};
  assert.equal(await runCli(['setup','--yes','--json','--server','https://artifactbin.dev'],context),0);
  await assert.rejects(stat(join(home,'.artifactbin','config.json')),{code:'ENOENT'},'the public server needs no record');
  assert.equal(await runCli(['setup','--yes','--json','--server=https://self.example'],context),0);
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin','config.json'),'utf8')),{host:'https://self.example'});
  out.length=0;
  assert.equal(await runCli(['help','--json'],context),0,'no --server: the recorded origin is the one afbin names');
  assert.match(out.join(''),/self\.example\/chat\/install\.sh/,out.join('').slice(0,300));
  assert.doesNotMatch(out.join(''),/artifactbin\.dev/,'the public server is no longer this afbin\'s default');
  // A link on the recorded origin is this afbin's own server: no --server, no wrong_server (codex, eval run local17).
  const hosts:string[]=[];const head={id:'abc123',version:1,edit_id:'edit1',state:digest('s1'),markup:'<p id="p001">Head</p>',format:'markup',title:'T',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
  const request:typeof fetch=async(input)=>{const url=new URL(String(input));hosts.push(url.host);if(url.pathname==='/api/artifacts/abc123')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});throw new Error(`Unexpected ${url}`);};
  await saveConnection({server:'https://self.example',token:'mx_self'},home);
  out.length=0;
  assert.equal(await runCli(['pull','https://self.example/a/abc123','--output','doc.jsx','--json'],{...context,fetch:request}),0,out.join(''));
  assert.deepEqual(hosts,['self.example']);
  assert.equal(await runCli(['setup','--yes','--json','--server','https://other.example'],context),0);
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin','config.json'),'utf8')),{host:'https://self.example'},'the first origin stays the default');
 }finally{await rm(home,{recursive:true,force:true});}
});
