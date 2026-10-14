import {credentialPaths} from '@artifactbin/utils/node/credentials';
import {describe,it,expect} from 'vitest';
import {llmsText} from '@/lib/serving/agent-references.server';
import {skillTree} from '../skills';
import {renderSkill} from '../skills/render';

describe('one root for installed and direct HTTP agents',()=>{
 it('gives URL readers complete HTTP operations while installed skills keep CLI operations',()=>{
  const origin='https://skills-contract.example';
  const http=llmsText(origin);
  const cli=withTeachingOrigin(teaching.files['SKILL.md'],origin);
  for(const operation of ['POST /api/artifacts','GET /api/artifacts/<id>','POST /api/artifacts/<id>/prepare','POST /api/artifacts/<id>/edits'])expect(http).toContain(operation);
  for(const field of ['expectedVersion','document_update','refresh_token','client_id','persistent secret store'])expect(http).toContain(field);
  expect(http).toContain('If there are no saved credentials, you must ask the user for their email to complete authentication. Do not invent an email.');
  expect(http).not.toContain('afbin pull');expect(http).not.toContain('afbin push');
  expect(cli).toContain('afbin pull');expect(cli).toContain('afbin push');
  expect(cli).not.toContain('POST /api/artifacts/<id>/prepare');
 });
 it('distinguishes an installed CLI from downloading one through npx',()=>{
  const root=llmsText('https://skills-contract.example');
  expect(root).toContain('npx downloads the CLI');
  expect(root).not.toContain('If `afbin` is missing: run');
 });
 it('serves precisely the root body with online topic links, without appending a second manual',()=>{
  const origin='https://skills-contract.example';
  const root=skillTree().get('artifactbin/SKILL.md')!;
  const expected=renderSkill(root,{base:origin,transport:'http'}).replace(/\]\(references\/([a-z0-9-]+)\.md(#[^)\s]+)?\)/g,(_match,name:string,hash:string|undefined)=>`](${origin}/llms/${name}${hash??''})`);
  expect(llmsText(origin).trim()).toBe(expected.trim());
 });
});

import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {skillPackageFiles,skillZip} from '../skills/package';
import {projectSkillLinks,renderTree,skillFileWithFrontmatter} from '../skills/serve';
import {publicGuideText} from '@/lib/serving/agent-references.server';
import teaching from '../../../cli/src/generated/teaching.json';
import {withTeachingOrigin} from '../../../cli/src/teaching-origin';
import {GET as zipRoute} from '@/app/skills/artifactbin.zip/route';

describe('installable shared skill folder',()=>{
 it('rewrites root/backlinks and anchors on the supplied origin',()=>{
  const file=skillTree().get('artifactbin/references/http-api.md')!;
  expect(projectSkillLinks(file,'[root](../SKILL.md#read-first) [task](./http-auth.md#sign-in)','https://recipient.example')).toBe('[root](https://recipient.example/llms.txt#read-first) [task](https://recipient.example/llms/http-auth#sign-in)');
  expect(publicGuideText('../SKILL','https://recipient.example')).toBeNull();
 });
 it('extracts a valid ZIP with the same frontmatter, references as CLI setup uses',async()=>{
  const origin='https://recipient.example';
  const expected=skillPackageFiles(skillTree(),origin);
  const cli=Object.fromEntries(Object.entries(teaching.files).map(([name,text])=>[name,withTeachingOrigin(text,origin)]));
  expect(expected['SKILL.md']).not.toBe(cli['SKILL.md']);
  expect(Object.keys(expected)).not.toContain('scripts/credentials.mjs');
  expect(Object.keys(cli)).not.toContain('scripts/credentials.mjs');
  for(const [transport,files] of [['http',expected],['cli',cli]] as const){
   for(const {file,text} of renderTree(skillTree(),origin,transport))expect(files[file.path.replace(/^artifactbin\//,'')],`${transport}: ${file.path}`).toBe(skillFileWithFrontmatter(file,text));
  }
  for(const files of [expected,cli])expect(Object.keys(files).some(name=>name.startsWith('scripts/'))).toBe(false);
  expect(expected['references/publishing-datasets.md']).toContain('## HTTP dataset creation');
  expect(cli['references/publishing-datasets.md']).not.toContain('## HTTP dataset creation');
  expect(Object.keys(expected).some(name=>name.startsWith('fragments/'))).toBe(false);
  const response=await zipRoute(new Request(`${origin}/skills/artifactbin.zip`));
  expect(response.headers.get('content-type')).toBe('application/zip');
  const dir=mkdtempSync(path.join(tmpdir(),'artifactbin-skill-zip-'));
  try{
   const zip=path.join(dir,'artifactbin.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
   execFileSync('unzip',['-q','-n',zip,'-d',dir]);
   for(const [name,text] of Object.entries(expected))expect(readFileSync(path.join(dir,'artifactbin',name),'utf8'),name).toBe(text);
   expect(expected['SKILL.md']).toMatch(/^---\nname: artifactbin\n/);
   expect(expected['SKILL.md']).toContain(origin);

   expect(Object.keys(expected)).not.toContain('.afbin-skill.json');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('keeps public root and guide projections within the reading budget',()=>{
  const base='https://app.artifactbin.dev';
  expect(Buffer.byteLength(llmsText(base))).toBeLessThanOrEqual(8192);
  for(const file of skillTree().files.filter(file=>file.ref&&file.kind==='guide'))expect(Buffer.byteLength(publicGuideText(file.file.replace(/\.md$/,''),base)!),file.path).toBeLessThanOrEqual(8192);
 });
 it('leaves room in the packaged data guide for origin expansion',()=>{
  const files=skillPackageFiles(skillTree(),'https://app.artifactbin.dev');
  expect(Buffer.byteLength(files['references/markup-data.md']!)).toBeLessThanOrEqual(7992);
  expect(Buffer.byteLength(publicGuideText('markup-data','https://app.artifactbin.dev')!)).toBeLessThanOrEqual(7992);
 });
 it('rejects arbitrary archive members and traversal',()=>{
  for(const name of ['../SKILL.md','scripts/other.mjs','/root/file','references/../secrets.md'])expect(()=>skillZip({[name]:'bad'})).toThrow('Unsupported skill member');
 });
});

 it('reuses the same procedure fragments in roots and references without changing reference transport',()=>{
  const base='https://reuse.example';
  const tree=skillTree();
  const root=tree.get('artifactbin/SKILL.md')!;
  for(const transport of ['http','cli'] as const){
   const text=renderSkill(root,{base,transport});
   for(const [operation,reference] of [['authentication',transport==='http'?'http-auth':'publishing-auth'],['creation',transport==='http'?'http-authoring':'publishing'],['editing',transport==='http'?'http-authoring':'publishing']]){
    const fragment=renderSkill({...root,body:`[% include "fragments/${transport}-${operation}.md" %]`},{base,transport}).trim();
    expect(text).toContain(fragment);
    const ref=tree.get(`artifactbin/references/${reference}.md`)!;
    const rendered=renderSkill(ref,{base,transport}).replace(/\]\((?!https:)([a-z-]+\.md)/g,'](references/$1');
    expect(rendered).toContain(fragment);
    expect(renderSkill(ref,{base,transport:'cli'})).toBe(renderSkill(ref,{base,transport:'http'}));
   }
  }
  expect(()=>renderSkill({...root,body:'[% include "fragments/missing.md" %]'},{base})).toThrow();
 });

it.each(['https://docs.example','http://app.lvh.me:5001'])('projects the existing credential backing path for HTTP and installed help on %s',origin=>{
 const expected=credentialPaths(origin,'~/.artifactbin').backingPath;
 const http=publicGuideText('http-auth',origin)!;
 const cli=withTeachingOrigin(teaching.files['references/http-auth.md'],origin);
 for(const text of [http,cli,llmsText(origin)]){
  expect(text).toContain(expected);
  expect(text).not.toContain('__AFBIN_CREDENTIAL_PATH__');
  expect(text).not.toContain('credentials.mjs');
 }
 expect(expected).not.toBe(credentialPaths('https://other.example','~/.artifactbin').backingPath);
});

it('teaches direct HTTP monitoring with baseline, cursor progression and bounded waits',()=>{
 const text=publicGuideText('monitoring','https://monitor.example')!;
 expect(text).not.toContain('watch-comments.mjs');
 expect(text).toContain('after=now&wait=0');
 expect(text).toContain('after=CURSOR&wait=60');
 expect(text).toContain('next_cursor');
 expect(text).toContain('has_more');
 expect(text).toContain('immediately');
 expect(text).toContain('timeout longer');
});
