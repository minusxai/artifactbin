import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,stat,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {digest} from '../src/files';
import {runCli} from '../src/dispatch';
import {installSkills,skillTargets,skillStatus,planSkills} from '../src/skill-install';

const externalSkill=(text:string)=>`---\nname: artifactbin\ndescription: External skill.\n---\n${text}`;

test('ordinary setup reuses an externally installed skill without replacing its root',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-owned-contract-'));
 try{
  const target=skillTargets(home,{}).pi;
  await mkdir(target,{recursive:true});
  await writeFile(join(target,'SKILL.md'),'---\nname: artifactbin\ndescription: External Artifactbin skill.\n---\nExternal skill');
  await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.match(await readFile(join(target,'SKILL.md'),'utf8'),/External skill/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup reuses a project shared skill and reports duplicate locations without creating a home copy',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-project-contract-'));
 try{
  const cwd=join(home,'project','nested'),project=join(home,'project','.agents','skills','artifactbin');
  await mkdir(cwd,{recursive:true});await mkdir(project,{recursive:true});await writeFile(join(project,'SKILL.md'),externalSkill('Project skill'));
  const result=await installSkills(['codex'],{home,env:{},cwd,files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.equal(result.installations[0]!.status,'reused');assert.equal(result.installations[0]!.path,await realpath(project));
  assert.equal((await lstat(skillTargets(home,{}).codex)).isSymbolicLink(),true);
  const target=skillTargets(home,{}).codex;await rm(target);await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),externalSkill('Global skill'));
  const duplicate=await installSkills(['codex'],{home,env:{},cwd,files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.deepEqual(duplicate.installations[0]!.duplicates,[await realpath(project)]);
  assert.equal(await readFile(join(project,'SKILL.md'),'utf8'),externalSkill('Project skill'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('managed edits and retired edited references survive ordinary updates; explicit takeover backs up',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-edited-contract-'));
 try{
  const options={home,env:{},files:{'SKILL.md':'Managed','references/old.md':'Old'},version:'1.0.0'};
  await installSkills(['pi'],options);const target=skillTargets(home,{}).pi;
  await writeFile(join(target,'SKILL.md'),'Edited');await writeFile(join(target,'references/old.md'),'Edited reference');
  const updated={...options,files:{'SKILL.md':'Replacement'},version:'2.0.0'};
  const ordinary=await installSkills(['pi'],updated);assert.equal(ordinary.installations[0]!.status,'modified');
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'Edited');
  const takeover=await installSkills(['pi'],{...updated,takeover:true});
  assert.equal(await readFile(join(takeover.installations[0]!.backup!,'SKILL.md'),'utf8'),'Edited');
  assert.equal(await readFile(join(target,'references/old.md'),'utf8'),'Edited reference');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('external symlink installation is preserved and reused without claiming ownership',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-symlink-contract-'));
 try{
  const external=join(home,'download'),target=skillTargets(home,{}).codex;
  await mkdir(external);await writeFile(join(external,'SKILL.md'),externalSkill('Download'));await mkdir(dirname(target),{recursive:true});await symlink(external,target);
  const result=await installSkills(['codex'],{home,env:{},files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.equal(result.installations[0]!.status,'reused');assert.equal((await lstat(target)).isSymbolicLink(),true);
  assert.equal(await readFile(join(external,'SKILL.md'),'utf8'),externalSkill('Download'));await assert.rejects(stat(join(external,'.afbin-skill.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup exposes explicit takeover while ordinary CLI setup preserves external content',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-cli-takeover-'));
 try{
  const target=skillTargets(home,{}).pi;await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),externalSkill('External'));
  const output:string[]=[];const context={home,cwd:home,env:{},stdout:(value:string)=>output.push(value),stderr:(value:string)=>output.push(value)};
  assert.equal(await runCli(['setup','--harness','pi','--no-global','--json'],context),0,output.join(''));
  assert.equal(JSON.parse(output.join('')).installations[0].status,'reused');output.length=0;
  assert.equal(await runCli(['setup','--harness','pi','--no-global','--takeover','--json'],context),0,output.join(''));
  const item=JSON.parse(output.join('')).installations[0];assert.equal(item.status,'updated');
  assert.equal(await readFile(join(item.backup,'SKILL.md'),'utf8'),externalSkill('External'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('explicit takeover of another installer manifest always backs up and does not claim ordinary ownership',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-source-contract-'));
 try{
  const target=skillTargets(home,{}).pi;await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),externalSkill('External'));
  await writeFile(join(target,'.afbin-skill.json'),JSON.stringify({source:'download',version:'1.0.0',files:{'SKILL.md':digest(externalSkill('External'))}}));
  const result=await installSkills(['pi'],{home,env:{},files:{'SKILL.md':'External'},version:'1.0.0',takeover:true});
  assert.ok(result.installations[0]!.backup,'external ownership must be recoverable even if content matches');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('read-only skill status discovers project installation and reports its ownership',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-status-contract-'));
 try{
  const cwd=join(home,'project'),target=join(cwd,'.codex','skills','artifactbin');
  await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),externalSkill('Project'));
  const result=await skillStatus(home,{},cwd);const codex=result.find(item=>item.harness==='codex')!;
  assert.equal(codex.installed,true);assert.equal(codex.path,await realpath(target));assert.equal(codex.source,'external');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('selected Claude harness discovers a shared external skill through a directory link without copying it',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-shared-claude-'));
 try{
  const shared=join(home,'.agents','skills','artifactbin'),target=skillTargets(home,{}).claude;
  await mkdir(shared,{recursive:true});await writeFile(join(shared,'SKILL.md'),externalSkill('Shared external'));
  const result=await installSkills(['claude'],{home,env:{},files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.equal(result.installations[0]!.status,'reused');assert.equal((await lstat(target)).isSymbolicLink(),true);
  assert.equal(await realpath(target),await realpath(shared));assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),externalSkill('Shared external'));
  assert.equal(result.installations[0]!.links![0]!.path,target);
  await assert.rejects(stat(join(shared,'.afbin-skill.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('directory link permission failure reports a conflict and keeps the external folder untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-link-conflict-'));
 try{
  const shared=join(home,'.agents','skills','artifactbin'),target=skillTargets(home,{}).claude;
  await mkdir(shared,{recursive:true});await writeFile(join(shared,'SKILL.md'),externalSkill('External'));
  const result=await installSkills(['claude'],{home,env:{},files:{'SKILL.md':'Replacement'},version:'1.0.0',link:async()=>{throw Object.assign(new Error('Windows denied link'),{code:'EPERM'});}});
  assert.equal(result.installations[0]!.status,'conflict');assert.match(result.installations[0]!.recovery!,/link|junction/i);
  await assert.rejects(stat(target),{code:'ENOENT'});assert.equal(await readFile(join(shared,'SKILL.md'),'utf8'),externalSkill('External'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('unchanged legacy CLI manifests migrate provenance; edited legacy contents stay preserved',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-legacy-skill-'));
 try{
  const target=skillTargets(home,{}).pi;await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),'Old');
  await writeFile(join(target,'.afbin-skill.json'),JSON.stringify({version:'1.0.0',files:{'SKILL.md':digest('Old')}}));
  const options={home,env:{},files:{'SKILL.md':'New'},version:'2.0.0'};
  assert.equal((await installSkills(['pi'],options)).installations[0]!.status,'updated');
  assert.equal(JSON.parse(await readFile(join(target,'.afbin-skill.json'),'utf8')).source,'afbin-cli');
  await writeFile(join(target,'.afbin-skill.json'),JSON.stringify({version:'2.0.0',files:{'SKILL.md':digest('New')}}));
  await writeFile(join(target,'SKILL.md'),'Edited legacy');
  assert.equal((await installSkills(['pi'],{...options,version:'3.0.0'})).installations[0]!.status,'modified');
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'Edited legacy');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('takeover plan predicts update and leaves settings, backup and harness directories untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-plan-takeover-'));
 try{
  const shared=join(home,'.agents','skills','artifactbin');await mkdir(shared,{recursive:true});await writeFile(join(shared,'SKILL.md'),externalSkill('Shared'));
  const plans=await planSkills(['claude'],{home,env:{},takeover:true});assert.equal(plans[0]!.status,'update');assert.equal(plans[0]!.link_required,true);
  await assert.rejects(stat(skillTargets(home,{}).claude),{code:'ENOENT'});await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('CLI partial link conflict returns a nonzero exit and preserves both destinations',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-cli-conflict-'));
 try{
  const shared=join(home,'.agents','skills','artifactbin'),target=skillTargets(home,{}).claude;
  await mkdir(shared,{recursive:true});await writeFile(join(shared,'SKILL.md'),externalSkill('Shared'));
  await mkdir(target,{recursive:true});await writeFile(join(target,'notes'),'Keep');
  const output:string[]=[];
  assert.equal(await runCli(['setup','--harness','claude','--harness','pi','--no-global','--json'],{home,cwd:home,env:{},stdout:value=>output.push(value),stderr:()=>{}}),2);
  const result=JSON.parse(output.join(''));assert.ok(result.installations.some((item:{status:string})=>item.status==='conflict'));assert.ok(result.installations.some((item:{status:string})=>item.status==='reused'));
  assert.equal(await readFile(join(target,'notes'),'utf8'),'Keep');assert.equal(await readFile(join(shared,'SKILL.md'),'utf8'),externalSkill('Shared'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup never links a shared folder whose skill root has no artifactbin name',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-invalid-shared-'));
 try{
  const shared=join(home,'.agents','skills','artifactbin');await mkdir(shared,{recursive:true});await writeFile(join(shared,'SKILL.md'),'garbage');
  const result=await installSkills(['claude'],{home,env:{},files:{'SKILL.md':'Replacement'},version:'1.0.0'});
  assert.equal(result.installations[0]!.status,'conflict');await assert.rejects(stat(skillTargets(home,{}).claude),{code:'ENOENT'});
  assert.equal(await readFile(join(shared,'SKILL.md'),'utf8'),'garbage');
 }finally{await rm(home,{recursive:true,force:true});}
});
