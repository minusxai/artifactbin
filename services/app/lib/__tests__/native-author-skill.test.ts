import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {skillTree,renderSkill,SKILL_FILE_MAX_BYTES} from '@/lib/skills';
import {isPublicSkillTopic} from '@/lib/skills/public-surface';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
import {publicGuideText,llmsText} from '@/lib/serving/agent-references.server';
const BASE='https://example.test';
describe('one installable native HTML author skill',()=>{
 it('teaches native API and viewer/private versus shared state without a legacy transport',()=>{
  const root=llmsText(BASE);
  for(const value of ['normal HTML','@afbin/apollo','POST /api/artifacts','PUT /api/artifacts/ID','expectedVersion','expectedState','Idempotency-Key','data-af-id'])expect(root).toContain(value);
  expect(root).not.toMatch(/afbin |@afbin\/cli|afbin pull|\/prepare|<Helmet>|className=/);
  for(const topic of ['npm-local','commands','publishing-auth','markup','http-document-graph','http-authoring'])expect(publicGuideText(topic,BASE)).toBeNull();
 });
 it('keeps public guides concise and every installed guide link within the actual archive',()=>{
  const tree=skillTree(),files=skillPackageFiles(tree,BASE);
  for(const file of tree.files.filter(file=>file.ref&&isPublicSkillTopic(file.file.replace(/\.md$/,'')))){
   expect(Buffer.byteLength(renderSkill(file,{base:BASE,transport:'http'})),file.file).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  }
  for(const [name,text] of Object.entries(files).filter(([name])=>name.endsWith('.md'))){
   expect(text,name).not.toMatch(/@afbin\/cli|chat\/(?:install|ensure-node)|afbin push/);
   for(const [,target] of text.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)){
    const relative=path.posix.normalize(path.posix.join(path.posix.dirname(name),target!));
    expect(Object.hasOwn(files,relative),`${name}: ${target}`).toBe(true);
   }
  }
  for(const sample of ['report.html','csv-dashboard.html','shared-app.html','repairs.csv','garden.ts'])expect(Object.hasOwn(files,'examples/'+sample)).toBe(true);
  expect(Object.hasOwn(files,'scripts/publish.mjs')).toBe(true);
 });
 it('unpacks into a fresh harness directory and prepares a request using only the installed files',()=>{
  const files=skillPackageFiles(skillTree(),BASE),dir=mkdtempSync(path.join(tmpdir(),'native-skill-install-'));
  try{
   const zip=path.join(dir,'skill.zip');writeFileSync(zip,skillZip(files));
   execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),request=path.join(dir,'request.json');
   expect(readFileSync(path.join(installed,'SKILL.md'),'utf8')).toContain('normal HTML');
   execFileSync(process.execPath,[path.join(installed,'scripts/publish.mjs'),'--prepare','shared-app','--server',BASE,'--output',request],{cwd:installed});
   const saved=JSON.parse(readFileSync(request,'utf8'));
   expect(saved.body.html).toContain('data-af-name="garden"');
   expect(saved.body.backendSources.garden).toContain('@auth(role:EDITOR)');
   expect(saved).not.toHaveProperty('token');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
