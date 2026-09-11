import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {install} from './skills.mjs';
test('selected local skills install once, preserve opt-outs, back up edits and update without prompts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-skills-'));
 try {
  await mkdir(join(root,'.claude/skills/other'),{recursive:true});await writeFile(join(root,'.claude/skills/other/SKILL.md'),'unrelated');
  assert.equal((await install(root,['pi','opencode'],'v1')).changed,2);
  assert.equal((await install(root,undefined,'v1')).changed,0);
  await writeFile(join(root,'.pi/agent/skills/artifactbin/SKILL.md'),'user edit');
  assert.equal((await install(root,undefined,'v2')).changed,2);
  assert.equal(await readFile(join(root,'.pi/agent/skills/artifactbin/SKILL.md.backup'),'utf8'),'user edit');
  await assert.rejects(readFile(join(root,'.codex/skills/artifactbin/SKILL.md')), {code:'ENOENT'});
  assert.equal(await readFile(join(root,'.claude/skills/other/SKILL.md'),'utf8'),'unrelated');
  assert.equal((await install(root,['none'],'v3')).changed,0);
  assert.equal((await install(root,undefined,'v4')).changed,0);
 }finally {await rm(root,{recursive:true,force:true});}
});
