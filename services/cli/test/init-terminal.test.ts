import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node-pty';
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
