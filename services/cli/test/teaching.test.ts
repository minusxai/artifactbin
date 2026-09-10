import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {localSkillFiles,manPage} from '../src/teaching';
test('bundled skill links resolve locally and every template example validates offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-teaching-'));
 try{
  assert.ok(localSkillFiles['SKILL.md']);assert.match(manPage(),/afbin/);
  for(const [path,source] of Object.entries(localSkillFiles))for(const match of source.matchAll(/\]\(([^)]+\.md)\)/g)){
   if(/^[a-z]+:/i.test(match[1]))continue;
   const target=join(path.includes('/')?path.slice(0,path.lastIndexOf('/')):'',match[1]);assert.ok(localSkillFiles[target],`${path} links to missing ${target}`);
  }
  await writeFile(join(root,'sales.csv'),'region,total\nEast,12\n');
  for(const template of ['editorial','dashboard','deck','scrolly']){
   const output:string[]=[];const context={cwd:root,home:root,interactive:false,stdout:(s:string)=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('bundled teaching must stay offline')};
   assert.equal(await runCli(['help',template],context),0);await writeFile(join(root,template+'.jsx'),output.join(''));output.length=0;
   assert.equal(await runCli(['validate',template+'.jsx','--json'],context),0,output.join(''));
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bundled guidance never teaches removed transports or reference spellings',()=>{
 const corpus=Object.values(localSkillFiles).join('\n');
 assert.doesNotMatch(corpus,/\bMCP\b|\/docs\/|source="<datasetId>"|from ref_<id>/);
 assert.match(corpus,/source="ref:<id>"/);
});
