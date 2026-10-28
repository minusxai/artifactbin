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
  // The install metadata is named in SKILL.md; its values are validated by the native reader and by autofix.
  const skill=files['SKILL.md']!;
  for(const name of ['artifactbin:pwa-enabled','-name','-short-name','-theme-color','-background-color','-icon'])expect(skill).toContain(name);
  const head='<meta name="artifactbin:pwa-enabled" content="true"><meta name="artifactbin:pwa-name" content="Garden tasks"><meta name="artifactbin:pwa-short-name" content="Garden"><meta name="artifactbin:pwa-theme-color" content="#234b35"><meta name="artifactbin:pwa-background-color" content="#ffffff"><meta name="artifactbin:pwa-icon" content="ref:Ab1234">';
  expect(htmlPwaSettings('<html><head>'+head+'</head><body></body></html>')).toEqual({enabled:true,name:'Garden tasks',shortName:'Garden',themeColor:'#234b35',backgroundColor:'#ffffff',icon:'Ab1234'});
  const image=snippets('runtime').find(html=>html.includes('ref:abc123'))!;
  expect(image).toBeTruthy();
  const html='<html><head></head><body>'+image+'</body></html>';
  const packed=await packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage:async()=>({bytes:new Uint8Array([1,2,3]),mime:'image/png'}),maxBytes:10000});
  expect(packed).toContain('src="data:image/png;base64,AQID"');
  expect(packed).toContain('alt="Garden beds after the harvest"');
 });
 it('executes the documented namespace input mutation against the composed backend SDL',async()=>{
  const {composePageSchema,executePageOperation}=await import('@/lib/page-operations');
  const guide=publicGuideText('backends',BASE)!;
  const query=guide.match(/gql`(mutation Save[^`]+)`/)?.[1];
  expect(query).toBeTruthy();
  const schema=composePageSchema([{name:'budget',fileId:'backend1',version:'v1',typeDefs:'input BudgetInput {category:String!,amount:Int!} type Query {count:Int} type Mutation {save(items:[BudgetInput!]!):Boolean!}'}]);
  const response=await executePageOperation({schema,request:{query:query!,variables:{items:[{category:'Food',amount:200}]}},caller:{pageId:'PAGE12',subject:'test-user',role:'OWNER'},signal:new AbortController().signal,invoke:async call=>{expect(call.args.items).toEqual([{category:'Food',amount:200}]);return true;}});
  expect(response.errors).toBeUndefined();expect(response.data).toEqual({budget:{save:true}});
 });
 it('teaches native API and viewer/private versus shared state without a legacy transport',()=>{
  const root=llmsText(BASE);
  for(const value of ['normal HTML','@afbin/apollo','POST /api/artifacts','scripts/read.mjs','scripts/publish.mjs','data-af-id'])expect(root).toContain(value);
  expect(root).toContain('/llms/html-operations');
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
  for(const value of ['/api/artifacts/${artifactId}/annotations','String(head.version)','next_cursor','cursor','data-af-id','iframe[data-mx-document-frame]','page.getByRole','page.locator','page.mainFrame()','scripts/check.mjs'])expect(guide).toContain(value);
  const files=skillPackageFiles(skillTree(),BASE);
  expect(guide).toContain('iframe[data-mx-document-frame]');
  // What used to live in the guide now ships at the top of the scripts and component sources.
  const check=files['scripts/check.mjs']!,comment=files['scripts/comment.mjs']!;
  for(const value of ['page.getByRole','page.mainFrame()','overflow','--viewer'])expect(check).toContain(value);
  expect(check.slice(0,check.indexOf('import'))).not.toContain('frameLocator(');
  expect(comment).toContain('watch');expect(comment).toContain('react');
  expect(files['components/slide-deck.ts']).toContain(`import '@afbin/slide-deck';`);
  for(const [name,text] of Object.entries(files).filter(([name])=>name.startsWith('components/')))expect(text.slice(0,text.indexOf('*/')),name).not.toMatch(/\bregister[A-Z]|\.\/components\//);
  expect(files['components/register-component.ts']).toBeUndefined();
  for(const gone of ['html-components','html-examples','html-uploads','html-sharing','comment-reactions','publication-bundles','html-preview','local-files'])expect(files[`references/${gone}.md`],gone).toBeUndefined();
 });
 it('ships only what agents read and run: no compiled components or platform bundles, within the size budget',async()=>{
  const archive=Buffer.from(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer());
  const members:string[]=[];let offset=0;
  while(archive.readUInt32LE(offset)===0x04034b50){const size=archive.readUInt32LE(offset+18),name=archive.readUInt16LE(offset+26);members.push(archive.subarray(offset+30,offset+30+name).toString().replace(/^artifactbin\//,''));offset+=30+name+size;}
  for(const name of members)expect(name).toMatch(/^(?:SKILL\.md|references\/[a-z0-9-]+\.md|examples\/[a-z0-9-]+\.(?:html|csv|ts)|design-systems\/[a-z0-9-]+\.css|components\/[a-z0-9-]+\.ts|scripts\/[a-z0-9-]+\.mjs)$/);
  // Pages import components as @afbin/<component> and the preview fetches the runtime and libraries from the server (D20).
  expect(members.filter(name=>/^components\/.*\.js$|^scripts\/preview-(?:runtime|libraries)\.mjs$|^fonts\//.test(name))).toEqual([]);
  for(const name of ['components/tabs.ts','components/accordion-model.ts','scripts/preview-html.mjs','scripts/preview-datasets.mjs','scripts/toolbox-platform.mjs','scripts/preview-platform.mjs'])expect(members).toContain(name);
  expect(members.some(name=>/^components\/(?:deck-gl|mermaid)/.test(name))).toBe(false);
  expect(archive.byteLength).toBeLessThan(1.5*1024*1024);
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
  for(const sample of ['report.html','csv-dashboard.html','shared-app.html','deck.html','repairs.csv','garden.ts'])expect(Object.hasOwn(files,'examples/'+sample)).toBe(true);
  expect(Object.hasOwn(files,'scripts/publish.mjs')).toBe(true);
 });
 it('prepares the documented samples from the actual installed ZIP with bounded local font graphs',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'native-skill-install-'));
  try{
   const zip=path.join(dir,'skill.zip');writeFileSync(zip,new Uint8Array(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer()));
   execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin');
   expect(readFileSync(path.join(installed,'SKILL.md'),'utf8')).toContain('normal HTML');
   for(const script of ['auth','serve','publish','read','export','check','graphql','comment','publication-bundle','preview','autofix'])expect(execFileSync(process.execPath,[path.join(installed,'scripts',script+'.mjs'),'--help'],{cwd:dir,encoding:'utf8'}),script).toContain('Usage:');
   // The installed autofix runs standalone and edits only the selected file.
   const page=path.join(dir,'page.html');writeFileSync(page,'<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>');
   expect(execFileSync(process.execPath,[path.join(installed,'scripts/autofix.mjs'),page],{cwd:dir,encoding:'utf8'})).toMatch(/^autofix: 2 fixed — written to page\.html/);
   expect(readFileSync(page,'utf8')).toContain('<meta charset="utf-8">');
   const occupied=path.join(dir,'occupied.json');writeFileSync(occupied,'retained');
   try{execFileSync(process.execPath,[path.join(installed,'scripts/publish.mjs'),'missing.html','--output',occupied,'--json'],{cwd:dir});throw Error('Expected output refusal');}catch(error){const failure=error as {status:number;stdout:Buffer};expect(failure.status).toBe(2);expect(JSON.parse(String(failure.stdout))).toMatchObject({ok:false,code:'output_exists'});}
   expect(readFileSync(occupied,'utf8')).toBe('retained');
   for(const sample of ['report','csv-dashboard','shared-app']){
    const request=path.join(dir,sample+'.json'),source=readFileSync(path.join(installed,'examples',sample+'.html'),'utf8');
    execFileSync(process.execPath,[path.join(installed,'scripts/publish.mjs'),'--prepare',sample,'--server',BASE,'--output',request,...(sample!=='report'?['--dataset-id','REALDATA123']:[])],{cwd:installed});
    const saved=JSON.parse(readFileSync(request,'utf8'));
    expect(saved).not.toHaveProperty('token');expect(saved.body.publicationBundle).toBeDefined();
    const plan=planPublicationBundle(saved.body.html,saved.body.publicationBundle);
    // Systems are named by a head meta and served by the platform with its fonts: nothing local is bundled for them.
    expect(saved.body.html,sample).toContain('name="artifactbin:design-system"');
    expect(plan.dependencies.some(dep=>dep.contentType==='font/woff2'||/design-systems\//.test(dep.path)),sample).toBe(false);
    expect(plan.dependencies.length,sample).toBeLessThan(99);
    expect(readFileSync(path.join(installed,'examples',sample+'.html'),'utf8')).toBe(source);
    if(sample==='csv-dashboard'){expect(saved.body.html).toContain('ref:REALDATA123');expect(saved.body.html).not.toContain('DATASET_ID');}
    if(sample==='shared-app'){expect(saved.body.html).toContain('data-af-name="garden"');expect(plan.backendSources.garden).toBe(saved.body.backendSources.garden);expect(saved.body.backendSources.garden).toContain('@auth(signedIn:true)');expect(saved.body.html).toContain('ref:REALDATA123');}
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});

describe('the shipped skill folder',()=>{
 it('contains exactly the intended reference guides, so new ones cannot creep in unnoticed',()=>{
  const files=skillPackageFiles(skillTree(),BASE);
  const refs=Object.keys(files).filter(name=>/^references\//.test(name)).sort();
  expect(refs).toEqual(['references/backends.md','references/datasets.md','references/dataviz.md','references/diagrams.md','references/maps.md','references/runtime.md']);
  // The design systems ship as self-documenting stylesheets, not guides.
  expect(Object.keys(files).filter(name=>/^design-systems\/[a-z0-9-]+\.css$/.test(name))).toHaveLength(13);
  // Direct-HTTP guides are served at /llms/TOPIC but never packed; the packed SKILL.md must not link them.
  expect(files['SKILL.md']).not.toMatch(/http-auth|html-operations/);
  for(const topic of ['http-auth','html-operations']){
   expect(files[`references/${topic}.md`],topic).toBeUndefined();
   expect(publicGuideText(topic,BASE),topic).toBeTruthy();
   expect(llmsText(BASE)).toContain(`${BASE}/llms/${topic}`);
  }
 });
});
