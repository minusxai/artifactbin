import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {CliError} from '../src/commands';

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

test('explicit SQL preparation checks the local engine and reports readiness without authentication',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-sql-'));const out:string[]=[];
 try{
  assert.equal(await runCli(['setup','--service','sql','--json'],{home,cwd:home,env:{},stdout:s=>out.push(s),stderr:s=>out.push(s),fetch:async()=>{throw new Error('no server authentication');}}),0,out.join(''));
  assert.deepEqual(JSON.parse(out.join('')),{services:[{name:'sql',status:'ready',execution:'local'}]});
  await assert.rejects(stat(join(home,'.artifactbin','settings.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
