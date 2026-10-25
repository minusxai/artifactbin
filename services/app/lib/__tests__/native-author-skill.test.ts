import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {skillTree,renderSkill,SKILL_FILE_MAX_BYTES} from '@/lib/skills';
import {isPublicSkillTopic} from '@/lib/skills/public-surface';
import {skillPackageFiles} from '@/lib/skills/package';
import {publicGuideText,llmsText} from '@/lib/serving/agent-references.server';
import {htmlPwaSettings} from '@/lib/html-page';
import {packOfflineHtmlImages} from '@/lib/export/native-html-media';
import {GET as skillArchive} from '@/app/skills/artifactbin.zip/route';
import {planPublicationBundle} from '@/lib/html-publication-bundle/plan';
import {parseHtmlNodeAnchor} from '@artifactbin/contracts';
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
  expect(root).toContain('/llms/html-operations');
  expect(root).toContain('The optional `scripts/publish.mjs` helper prepares new sample artifacts');
  expect(root).not.toMatch(/afbin |@afbin\/cli|afbin pull|\/prepare|<Helmet>|className=/);
  for(const topic of ['npm-local','commands','publishing-auth','markup','http-document-graph','http-authoring'])expect(publicGuideText(topic,BASE)).toBeNull();
 });
 it('publishes a native HTML operations guide with anchors and runner-frame verification',()=>{
  expect(isPublicSkillTopic('html-operations')).toBe(true);
  for(const topic of ['http-api','live-sessions','publishing-annotations'])expect(publicGuideText(topic,BASE),topic).toBeNull();
  const guide=publicGuideText('html-operations',BASE)!;
  const json=guide.match(/```json\n([\s\S]*?)\n```/)?.[1];
  expect(json).toBeTruthy();
  const anchor=JSON.parse(json!);
  expect(parseHtmlNodeAnchor(anchor)).toEqual(anchor);
  for(const value of ['/api/artifacts/${artifactId}/annotations','String(head.version)','next_cursor','`cursor` query parameter','data-af-id','iframe[data-mx-document-frame]','page.getByRole','page.locator','page.mainFrame()','auto-target the document frame','pageErrors','failedRequests','overflow','return {heading, body, overflow, pageErrors, failedRequests}','scripts/publish.mjs','PUT /api/artifacts/ID'])expect(guide).toContain(value);
  const browserExample=[...guide.matchAll(/```js\n([\s\S]*?)```/g)][1]?.[1];
  expect(browserExample).toBeTruthy();
  expect(browserExample).toContain('page.getByRole');
  expect(browserExample).not.toContain('frameLocator(');
  const files=skillPackageFiles(skillTree(),BASE);
  expect(files['references/html-operations.md']).toContain('iframe[data-mx-document-frame]');
  expect(publicGuideText('html-examples',BASE)).toContain('Slide deck with viewer-local navigation');
  expect(publicGuideText('html-examples',BASE)).toContain('registerSlideDeck');
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
 it('prepares the documented samples from the actual installed ZIP with bounded local font graphs',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'native-skill-install-'));
  try{
   const zip=path.join(dir,'skill.zip');writeFileSync(zip,new Uint8Array(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer()));
   execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin');
   expect(readFileSync(path.join(installed,'SKILL.md'),'utf8')).toContain('normal HTML');
   for(const sample of ['report','csv-dashboard','shared-app']){
    const request=path.join(dir,sample+'.json'),source=readFileSync(path.join(installed,'examples',sample+'.html'),'utf8');
    execFileSync(process.execPath,[path.join(installed,'scripts/publish.mjs'),'--prepare',sample,'--server',BASE,'--output',request,...(sample==='csv-dashboard'?['--dataset-id','REALDATA123']:[])],{cwd:installed});
    const saved=JSON.parse(readFileSync(request,'utf8'));
    expect(saved).not.toHaveProperty('token');expect(saved.body.publicationBundle).toBeDefined();
    const plan=planPublicationBundle(saved.body.html,saved.body.publicationBundle);
    expect(plan.dependencies.some(dep=>dep.contentType==='font/woff2'),sample).toBe(true);
    expect(plan.dependencies.length,sample).toBeLessThan(99);
    expect(readFileSync(path.join(installed,'examples',sample+'.html'),'utf8')).toBe(source);
    if(sample==='csv-dashboard'){expect(saved.body.html).toContain('ref:REALDATA123');expect(saved.body.html).not.toContain('DATASET_ID');}
    if(sample==='shared-app'){expect(saved.body.html).toContain('data-af-name="garden"');expect(plan.backendSources.garden).toBe(saved.body.backendSources.garden);expect(saved.body.backendSources.garden).toContain('@auth(role:EDITOR)');}
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
