import {parseCommand} from '../src/commands';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
// Exercise the real compiler without deleting a bundle another test is importing.
test('teaching bootstraps without its output and repairs stale output deterministically',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'afbin-teaching-'));
 try{
  for(const relative of ['package.json','tsconfig.json','scripts/register-yaml.cjs',
   'services/app/lib','services/app/skills','services/app/orchestrator/prompts','services/contracts/src','services/utils/src',
   'services/cli/src','services/cli/scripts','services/cli/package.json']){
   const target=join(fixture,relative);mkdirSync(dirname(target),{recursive:true});
   cpSync(join(repo,relative),target,{recursive:true,filter:source=>
    !source.endsWith('/generated/teaching.json')&&!source.includes('/__tests__')&&!source.includes('/dist/')});
  }
  symlinkSync(join(repo,'node_modules'),join(fixture,'node_modules'),'dir');
  const target=join(fixture,'services/cli/src/generated/teaching.json');
  const generate=(...args:string[])=>spawnSync(process.execPath,
   [join(fixture,'services/cli/scripts/generate-teaching.mjs'),...args],
   {cwd:fixture,encoding:'utf8',env:{...process.env,APP_PACKAGE_ROOT:join(fixture,'services/app')}});
  assert.equal(existsSync(target),false);
  const first=generate();assert.equal(first.status,0,first.stderr);
  const content=readFileSync(target,'utf8');
  const bundle=JSON.parse(content);
  assert.ok(bundle.files['SKILL.md']);assert.ok(bundle.files['references/remote-review.md']);
  const remoteGuide=bundle.files['references/remote-review.md'];
  const launch=remoteGuide.match(/```sh\n(afbin remote --json codex)\n```/);
  assert.ok(launch,'remote guide includes an afbin JSON launch example');
  assert.deepEqual(parseCommand(launch[1].split(' ').slice(1)),{command:'remote',flags:{json:true},positionals:['codex']});
  for(const text of ['--dangerously-skip-permissions','--yolo','OPENCODE_PERMISSION','Pi has no built-in tool approval prompts','Explicit permission flags'])assert.ok(remoteGuide.includes(text),text);
  for(const guide of [remoteGuide,bundle.files['references/publishing-annotations.md']]){
   assert.ok(guide.includes('--image'));assert.ok(guide.includes('image viewing tool'));assert.ok(guide.includes('drawn marks'));
  }
  const before=statSync(target).mtimeMs;
  assert.equal(generate('--check').status,0);
  assert.equal(generate().status,0);
  assert.equal(readFileSync(target,'utf8'),content);
  assert.equal(statSync(target).mtimeMs,before,'unchanged generation must not trigger watchers');
  writeFileSync(target,'<<<<<<< broken generated output');
  assert.notEqual(generate('--check').status,0);
  const repaired=generate();assert.equal(repaired.status,0,repaired.stderr);
  assert.equal(readFileSync(target,'utf8'),content);
 }finally{rmSync(fixture,{recursive:true,force:true});}
});
