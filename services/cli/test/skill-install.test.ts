import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,realpath,rm,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSkills,restartHints,skillTargets,selectSkills} from '../src/skill-install';
import {runCli} from '../src/dispatch';
const bundle={'SKILL.md':'---\nname: artifactbin\ndescription: Publish artifacts.\n---\nHello','references/a.md':'A'};
test('installation selects only requested harnesses, remembers opt-outs and backs up modified files',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-install-'));
 try{
  const options={home,env:{},files:bundle,version:'1.0.0'};
  const targets=skillTargets(home,{});
  const first=await installSkills(['pi','codex'],options);assert.equal(first.installations.length,2);
  assert.equal(await readFile(join(targets.pi,'SKILL.md'),'utf8'),bundle['SKILL.md']);
  await assert.rejects(stat(targets.claude),{code:'ENOENT'});
  assert.deepEqual(await selectSkills({home,env:{},interactive:false,detected:['claude','pi','codex']}),['pi','codex']);
  const stable=await installSkills(['pi','codex'],options);assert.ok(stable.installations.every(x=>x.status==='unchanged'));
  await writeFile(join(targets.pi,'SKILL.md'),'My edited skill');await writeFile(join(targets.pi,'notes.txt'),'Keep me');
  const updated=await installSkills(['pi'],{...options,files:{'SKILL.md':'New skill'},version:'2.0.0'});
  assert.equal(await readFile(join(updated.installations[0].backup!,'SKILL.md'),'utf8'),'My edited skill');
  assert.equal(await readFile(join(targets.pi,'notes.txt'),'utf8'),'Keep me');
  await assert.rejects(stat(join(targets.pi,'references/a.md')),{code:'ENOENT'});
  assert.equal((await stat(join(home,'.artifactbin','settings.json'))).mode&0o777,0o600);
  await installSkills([],{...options});assert.deepEqual(await selectSkills({home,env:{},interactive:false,detected:['pi']}),[]);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('shared physical destinations update once; unsafe bundle paths are refused before writes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-shared-install-'));
 try{
  const targets=skillTargets(home,{});await mkdir(targets.pi,{recursive:true});await mkdir(join(home,'.codex','skills'),{recursive:true});await symlink(targets.pi,targets.codex);
  const result=await installSkills(['pi','codex'],{home,env:{},files:bundle,version:'1.0.0'});
  assert.equal(result.installations.length,1);assert.deepEqual(result.installations[0].harnesses,['pi','codex']);
  await assert.rejects(installSkills(['claude'],{home,env:{},files:{'../escape':'bad'},version:'1.0.0'}),/bundle path/i);
  await assert.rejects(stat(targets.claude),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('interactive checklist starts with detected defaults and cancellation makes no writes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-select-'));
 try{
  assert.deepEqual(await selectSkills({home,env:{},interactive:true,detected:['pi','opencode'],choose:async choices=>{
   assert.deepEqual(choices.filter(x=>x.selected).map(x=>x.name),['pi','opencode']);return ['pi'];
  }}),['pi']);
  await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
  await assert.rejects(selectSkills({home,env:{},interactive:true,detected:[],choose:async()=>{throw new Error('cancelled');}}),/cancelled/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('malformed settings refuse explicit installation before any harness files change',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-invalid-settings-'));
 try {
  await mkdir(join(home,'.artifactbin'));await writeFile(join(home,'.artifactbin','settings.json'),'{broken');
  await assert.rejects(installSkills(['pi'],{home,env:{},files:bundle}),{code:'invalid_settings'});
  await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});
  assert.equal(await readFile(join(home,'.artifactbin','settings.json'),'utf8'),'{broken');
 }finally{await rm(home,{recursive:true,force:true});}
});

/**
 * Claude Code and Codex read their skills folder once, when the process starts;
 * pi and OpenCode read it per run. A skill written under a running Claude Code
 * is invisible until it restarts, and nothing said so.
 */
test('a harness that discovers skills at startup is told to restart; one that discovers per run is not',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-restart-'));
 try{
  const targets=skillTargets(home,{});const options={home,env:{},files:bundle,version:'1.0.0'};
  const fresh=await installSkills(['claude','codex','pi'],options);
  const installedAt=async(name:'claude'|'codex'|'pi')=>await realpath(targets[name]);
  assert.deepEqual(fresh.installations.filter(x=>x.restart_required).map(x=>x.path).sort(),[await installedAt('claude'),await installedAt('codex')].sort());
  assert.equal(fresh.installations.find(x=>x.harnesses.includes('pi'))?.restart_required,undefined);
  assert.deepEqual(restartHints(fresh.installations).sort(),[
   `Restart Claude Code to load the installed skill at ${await installedAt('claude')}.`,
   `Restart Codex to load the installed skill at ${await installedAt('codex')}.`,
  ].sort());
  // An install that changed nothing asks for no restart.
  const again=await installSkills(['claude','codex','pi'],options);
  assert.ok(again.installations.every(x=>x.status==='unchanged'&&x.restart_required===undefined));
  assert.deepEqual(restartHints(again.installations),[]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('an older invocation cannot downgrade newer installed skill files',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-skill-monotonic-'));
 try {
  await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'new'},version:'2.0.0'});
  await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'old'},version:'1.0.0'});
  assert.equal(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),'new');
 }finally{await rm(home,{recursive:true,force:true});}
});

const backupsDir=(home:string)=>join(home,'.artifactbin','skill-backups');

test('successive skill backups keep only the copy the latest update replaced, named for its version',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-skill-backup-prune-'));
 try{
  const targets=skillTargets(home,{}),backups=backupsDir(home);
  await mkdir(targets.pi,{recursive:true});await writeFile(join(targets.pi,'SKILL.md'),'hand written');
  const first=await installSkills(['pi'],{home,env:{},files:bundle,version:'1.0.0'});
  assert.equal(first.installations[0]!.backup,join(backups,'pi-unmanaged'),'a copy with no manifest says so in its name');
  assert.deepEqual(await readdir(backups),['pi-unmanaged']);
  await writeFile(join(targets.pi,'SKILL.md'),'my edit');
  const second=await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'v2'},version:'2.0.0'});
  assert.equal(second.installations[0]!.backup,join(backups,'pi-1.0.0'));
  assert.deepEqual(await readdir(backups),['pi-1.0.0'],'only the copy replaced by the most recent update is kept');
  assert.equal(await readFile(join(backups,'pi-1.0.0','SKILL.md'),'utf8'),'my edit');
  assert.equal(await readFile(join(targets.pi,'SKILL.md'),'utf8'),'v2');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('skill pruning keeps one backup per harness and never follows a symlink',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-skill-backup-harness-'));
 try{
  const targets=skillTargets(home,{}),backups=backupsDir(home);
  await installSkills(['pi','codex'],{home,env:{},files:bundle,version:'1.0.0'});
  await writeFile(join(targets.pi,'SKILL.md'),'pi edit');await writeFile(join(targets.codex,'SKILL.md'),'codex edit');
  await installSkills(['pi','codex'],{home,env:{},files:{'SKILL.md':'v2'},version:'2.0.0'});
  assert.deepEqual((await readdir(backups)).sort(),['codex-1.0.0','pi-1.0.0']);
  await mkdir(join(backups,'pi-0.9.0'),{recursive:true});await writeFile(join(backups,'pi-0.9.0','SKILL.md'),'ancient');
  const outside=join(home,'precious');await writeFile(outside,'not ours');
  await symlink(outside,join(backups,'pi-link'));
  await writeFile(join(targets.pi,'SKILL.md'),'pi edit two');
  const third=await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'v3'},version:'3.0.0'});
  assert.equal(third.installations[0]!.backup,join(backups,'pi-2.0.0'));
  assert.deepEqual((await readdir(backups)).sort(),['codex-1.0.0','pi-2.0.0','pi-link'],'another harness keeps its own backup; the symlink stays');
  assert.equal((await lstat(join(backups,'pi-link'))).isSymbolicLink(),true);
  assert.equal(await readFile(outside,'utf8'),'not ours','a symlink target outside the directory is never touched');
  assert.equal(await readFile(join(backups,'codex-1.0.0','SKILL.md'),'utf8'),'codex edit');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a second backup of the same version replaces the earlier copy instead of failing',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-skill-backup-same-'));
 try{
  const targets=skillTargets(home,{}),backups=backupsDir(home);
  await installSkills(['pi'],{home,env:{},files:bundle,version:'1.0.0'});
  await writeFile(join(targets.pi,'SKILL.md'),'first edit');
  await installSkills(['pi'],{home,env:{},files:bundle,version:'1.0.0'});
  await writeFile(join(targets.pi,'SKILL.md'),'second edit');
  const again=await installSkills(['pi'],{home,env:{},files:bundle,version:'1.0.0'});
  assert.equal(again.installations[0]!.backup,join(backups,'pi-1.0.0'));
  assert.deepEqual(await readdir(backups),['pi-1.0.0']);
  assert.equal(await readFile(join(backups,'pi-1.0.0','SKILL.md'),'utf8'),'second edit');
 }finally{await rm(home,{recursive:true,force:true});}
});

/**
 * ARTIFACTBIN_SKILLS=off — the switch a checkout's dev loop runs the branch CLI under.
 * Eager init runs before EVERY command, so without a switch `npm run afbin` rewrites the
 * owner's real `~/.claude/skills/artifactbin` from an unreleased build (it happened twice).
 * Off must hold at both boundaries: selection returns nothing even when a harness is named
 * outright, and installation writes nothing if a caller reaches it anyway.
 */
test('ARTIFACTBIN_SKILLS=off selects no harness, even one requested by name, and installs nothing',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-skills-off-'));
 try{
  const off={ARTIFACTBIN_SKILLS:'off'};const targets=skillTargets(home,off);
  assert.deepEqual(await selectSkills({home,env:off,interactive:false,detected:['claude','pi','codex','opencode']}),[]);
  assert.deepEqual(await selectSkills({home,env:off,interactive:false,requested:['claude']}),[]);
  assert.deepEqual(await selectSkills({home,env:off,interactive:true,yes:true,detected:['claude']}),[]);
  const result=await installSkills(['claude','pi'],{home,env:off,files:bundle,version:'1.0.0'});
  assert.deepEqual(result.installations,[]);
  assert.deepEqual(result.harnesses,[]);
  for(const target of Object.values(targets))await assert.rejects(stat(target),{code:'ENOENT'},target);
  await assert.rejects(stat(join(home,'.artifactbin','settings.json')),{code:'ENOENT'},'an off run records no selection either');
  // The same call without the switch does install — the assertion above is not vacuous.
  const on=await installSkills(['claude'],{home,env:{},files:bundle,version:'1.0.0'});
  assert.equal(on.installations.length,1);
  assert.equal(await readFile(join(skillTargets(home,{}).claude,'SKILL.md'),'utf8'),bundle['SKILL.md']);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('eager init installs the saved harnesses, and installs nothing under ARTIFACTBIN_SKILLS=off',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-init-skills-off-'));
 const home=join(base,'home'),work=join(base,'work');await mkdir(home);await mkdir(work);
 const run=async(env:NodeJS.ProcessEnv)=>{
  const out:string[]=[];
  const code=await runCli(['status','--json'],{cwd:work,home,env,interactive:false,stdout:x=>out.push(x),stderr:()=>{},fetch:async()=>{throw new Error('network during eager init');}});
  assert.equal(code,0);
  return out.join('');
 };
 try{
  await mkdir(join(home,'.artifactbin'),{recursive:true});
  await writeFile(join(home,'.artifactbin','settings.json'),JSON.stringify({harnesses:['claude','pi']}));
  await run({ARTIFACTBIN_SKILLS:'off'});
  for(const target of Object.values(skillTargets(home,{})))await assert.rejects(stat(target),{code:'ENOENT'},target);
  // Without the switch the same invocation writes both skills: the guard is what stopped it.
  await run({});
  assert.equal((await stat(join(skillTargets(home,{}).claude,'SKILL.md'))).isFile(),true);
  assert.equal((await stat(join(skillTargets(home,{}).pi,'SKILL.md'))).isFile(),true);
 }finally{await rm(base,{recursive:true,force:true});}
});
