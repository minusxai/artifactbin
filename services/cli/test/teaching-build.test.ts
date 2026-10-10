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
   'services/app/lib','services/app/skills','services/app/public/chat/release.json','services/runner/src','services/contracts/src','services/utils/src',
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
  assert.equal(existsSync(join(fixture,'services/app/dist')),false,'source teaching must not require a built app');
  assert.equal(existsSync(join(fixture,'services/cli/dist')),false,'source teaching must not require a built CLI');
  const first=generate();assert.equal(first.status,0,first.stderr);
  const content=readFileSync(target,'utf8');
  const bundle=JSON.parse(content);
  assert.ok(bundle.files['SKILL.md']);assert.ok(bundle.files['references/remote-review.md']);
  const authGuide=bundle.files['references/publishing-auth.md'];
  for(const instruction of ['If `afbin` is not installed, run `npx --yes @afbin/cli@latest setup` once (Windows PowerShell: `npx.cmd --yes @afbin/cli@latest setup`); it installs the `afbin` command and the agent skills.','If an old `afbin` reports `cli_npm_required`, run the setup line once.','afbin.cmd','install-node.sh','install-node.ps1','automatic updates run after a successful command finishes','`afbin update` installs the version the server names (else the latest) globally through npm','~/.artifactbin/npm'])assert.ok(authGuide.includes(instruction),instruction);
  assert.doesNotMatch(authGuide,/only prints the command for your next launch|launching the explicit npm command shown/);
  assert.doesNotMatch(authGuide,/shorthand|@afbin\/cli@latest <command>/);
  assert.equal(authGuide.split('npx --yes @afbin/cli@').length-1,1);
  assert.doesNotMatch(authGuide,/verified installer|published SHA-256|replaces that executable|Standalone installs check|chat\/install\.sh/);
  const publishingGuide=bundle.files['references/publishing.md'];
  for(const instruction of ['.artifactbin','local-to-remote ID mapping','credentials remain'])assert.ok(publishingGuide.includes(instruction),instruction);
  assert.doesNotMatch(publishingGuide,/writes nothing into your working directory|publication preserves them/);
  assert.match(bundle.files['references/publishing-versions.md'],/\.jsx\.html/);
  const exportGuide=bundle.files['references/publishing-versions.md'];
  assert.match(exportGuide,/--refresh.*published.*ID/);
  assert.match(exportGuide,/local file paths.*refused/);
  assert.match(exportGuide,/local dataset files.*server mutations/);
  assert.match(bundle.files['SKILL.md'],/export <artifact-url>/);

  assert.doesNotMatch(bundle.files['references/publishing-versions.md'],/It requires a published head/);
  assert.ok(authGuide.includes('CLI__DISABLE_AUTO_UPDATES=true'));
  assert.ok(authGuide.includes('at most hourly'));
  const remoteGuide=bundle.files['references/remote-review.md'];
  const launch=remoteGuide.match(/```sh\n(afbin remote --json codex)\n```/);
  assert.ok(launch,'remote guide includes an afbin JSON launch example');
  assert.deepEqual(parseCommand(launch[1].split(' ').slice(1)),{command:'remote',flags:{json:true},positionals:['codex']});
  for(const text of ['--dangerously-skip-permissions','--yolo','OPENCODE_PERMISSION','Pi has no built-in tool approval prompts','Explicit permission flags'])assert.ok(remoteGuide.includes(text),text);
  for(const text of ['remote_context_blocked','remote_context_unavailable','memory-only','existing approval'])assert.ok(remoteGuide.includes(text),text);
  assert.ok(remoteGuide.includes('publishing-annotations.md#inspect-comment-screenshots'));
  const imageGuide=bundle.files['references/publishing-annotations.md'];
  for(const instruction of ['--image','image viewing tool','drawn marks'])assert.ok(imageGuide.includes(instruction));
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
