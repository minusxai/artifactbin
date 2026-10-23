import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {skillTree,renderSkill,SKILL_FILE_MAX_BYTES} from '@/lib/skills';
import {isPublicSkillTopic} from '@/lib/skills/public-surface';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
import {publicGuideText,llmsText} from '@/lib/serving/agent-references.server';
import {htmlPwaSettings} from '@/lib/html-page';
import {packOfflineHtmlImages} from '@/lib/export/native-html-media';
const BASE='https://example.test';
describe('one installable native HTML author skill',()=>{
 it('runs the installed PWA and portable-image snippets against native contracts',async()=>{
  const files=skillPackageFiles(skillTree(),BASE);
  const snippets=(name:string)=>Array.from(files['references/'+name+'.md']!.matchAll(/```html\n([\s\S]*?)```/g),match=>match[1]!);
  const head=snippets('html-authoring').find(html=>html.includes('artifactbin:pwa-enabled'))!;
  expect(head).toBeTruthy();
  expect(htmlPwaSettings('<html><head>'+head+'</head><body></body></html>')).toEqual({enabled:true,name:'Garden tasks',shortName:'Garden',themeColor:'#234b35',backgroundColor:'#ffffff',icon:'Ab1234'});
  const image=snippets('html-runtime').find(html=>html.includes('ref:abc123'))!;
  expect(image).toBeTruthy();
  const html='<html><head></head><body>'+image+'</body></html>';
  const packed=await packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage:async()=>({bytes:new Uint8Array([1,2,3]),mime:'image/png'}),maxBytes:10000});
  expect(packed).toContain('src="data:image/png;base64,AQID"');
  expect(packed).toContain('alt="Garden beds after the harvest"');
 });
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
