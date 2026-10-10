import {describe,it,expect} from 'vitest';
import {llmsText} from '@/lib/serving/agent-references.server';
import {skillTree} from '../skills';
import {renderSkill} from '../skills/render';

describe('one root for installed and direct HTTP agents',()=>{
 it('distinguishes an installed CLI from downloading one through npx',()=>{
  const root=llmsText('https://skills-contract.example');
  expect(root).toContain('npx downloads the CLI');
  expect(root).not.toContain('If `afbin` is missing: run');
 });
 it('serves precisely the root body with online topic links, without appending a second manual',()=>{
  const origin='https://skills-contract.example';
  const root=skillTree().get('artifactbin/SKILL.md')!;
  const expected=renderSkill(root,{base:origin}).replace(/\]\(references\/([a-z0-9-]+)\.md(#[^)\s]+)?\)/g,(_match,name:string,hash:string|undefined)=>`](${origin}/llms/${name}${hash??''})`);
  expect(llmsText(origin).trim()).toBe(expected.trim());
 });
});

import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {skillPackageFiles,skillZip} from '../skills/package';
import {projectSkillLinks} from '../skills/serve';
import {publicGuideText} from '@/lib/serving/agent-references.server';
import teaching from '../../../cli/src/generated/teaching.json';
import {TEACHING_BASE} from '../../../cli/src/teaching-origin';
import {GET as helperRoute} from '@/app/skills/artifactbin/credentials.mjs/route';
import {GET as zipRoute} from '@/app/skills/artifactbin.zip/route';

describe('installable shared skill folder',()=>{
 it('rewrites root/backlinks and anchors on the supplied origin',()=>{
  const file=skillTree().get('artifactbin/references/http-api.md')!;
  expect(projectSkillLinks(file,'[root](../SKILL.md#read-first) [task](./http-auth.md#sign-in)','https://recipient.example')).toBe('[root](https://recipient.example/llms.txt#read-first) [task](https://recipient.example/llms/http-auth#sign-in)');
  expect(publicGuideText('../SKILL','https://recipient.example')).toBeNull();
 });
 it('extracts a valid ZIP with the same frontmatter, references and helper as CLI setup uses',async()=>{
  const origin='https://recipient.example';
  const expected=skillPackageFiles(skillTree(),origin);
  const cli=Object.fromEntries(Object.entries(teaching.files).map(([name,text])=>[name,text.split(TEACHING_BASE).join(origin)]));
  expect(expected).toEqual(cli);
  expect(await (await helperRoute()).text()).toBe(expected['scripts/credentials.mjs']);
  const response=await zipRoute(new Request(`${origin}/skills/artifactbin.zip`));
  expect(response.headers.get('content-type')).toBe('application/zip');
  const dir=mkdtempSync(path.join(tmpdir(),'artifactbin-skill-zip-'));
  try{
   const zip=path.join(dir,'artifactbin.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
   execFileSync('unzip',['-q','-n',zip,'-d',dir]);
   for(const [name,text] of Object.entries(expected))expect(readFileSync(path.join(dir,'artifactbin',name),'utf8'),name).toBe(text);
   expect(expected['SKILL.md']).toMatch(/^---\nname: artifactbin\n/);
   expect(expected['SKILL.md']).toContain(origin);
   expect(expected['scripts/credentials.mjs']).toContain('ARTIFACTBIN_HOME');
   expect(expected['scripts/watch-comments.mjs']).toContain('annotations/changes');
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
