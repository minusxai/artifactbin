import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {localSkillFiles,manPage} from '../src/teaching';
import {roffLiteral} from '../src/man';
test('bundled skill links resolve locally and every template example, including the brief\'s, validates offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-teaching-'));
 try{
  assert.ok(localSkillFiles['SKILL.md']);assert.match(manPage(),/afbin/);
  for(const [path,source] of Object.entries(localSkillFiles))for(const match of source.matchAll(/\]\(([^)]+\.md)\)/g)){
   if(/^[a-z]+:/i.test(match[1]))continue;
   const target=join(path.includes('/')?path.slice(0,path.lastIndexOf('/')):'',match[1]);assert.ok(localSkillFiles[target],`${path} links to missing ${target}`);
  }
  await writeFile(join(root,'sales.csv'),'month,region,revenue\n2026-07-01,East,12\n2026-08-01,West,9\n');
  for(const template of ['editorial','dashboard','deck','scrolly','example']){
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

test('help formats, destinations and the manual come from one command registry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-help-'));const out:string[]=[];
 const problems:string[]=[];
 const context={cwd:root,home:root,interactive:false,stdout:(s:string)=>out.push(s),stderr:(s:string)=>problems.push(s),fetch:async()=>assert.fail('help must stay offline')};
 try{
  assert.equal(await runCli(['help','--format','markdown'],context),0);
  const reference=out.join('');out.length=0;
  for(const command of ['push','export','update','help'])assert.match(reference,new RegExp(`^## ${command}$`,'m'),command);
  assert.equal(await runCli(['help','update','--format','markdown'],context),0);
  assert.match(out.join(''),/^# afbin update/);assert.match(out.join(''),/--dry-run/);out.length=0;
  // The manual is roff and documents the same flags; a prose topic has no manual page.
  assert.equal(await runCli(['help','export','--format','man','--output','-'],context),0);
  assert.match(out.join(''),/^\.TH AFBIN 1/);assert.match(out.join(''),/\.SH EXPORT/);out.length=0;
  assert.equal(await runCli(['help','markup','--format','man'],context),2);
  assert.match(problems.join(''),/^unsupported_format: /);problems.length=0;
  // --output never replaces an existing path, and never writes into a directory or a missing one.
  await writeFile(join(root,'taken.md'),'mine');
  assert.equal(await runCli(['help','--format','markdown','--output','taken.md','--json'],context),2);
  assert.match(out.join(''),/"output_exists"/);assert.equal(await readFile(join(root,'taken.md'),'utf8'),'mine');out.length=0;
  assert.equal(await runCli(['help','--format','man','--output','.','--json'],context),2);
  assert.match(out.join(''),/"output_exists"/);out.length=0;
  assert.equal(await runCli(['help','--format','man','--output','missing/afbin.1','--json'],context),2);
  assert.match(out.join(''),/"invalid_output"/);out.length=0;
  assert.equal(await runCli(['help','--format','man','--output','afbin.1','--json'],context),0);
  const written=JSON.parse(out.join(''));out.length=0;
  assert.equal(written.format,'man');assert.equal(written.bytes,Buffer.byteLength(manPage()));
  assert.equal(await readFile(join(root,'afbin.1'),'utf8'),manPage());
 }finally{await rm(root,{recursive:true,force:true});}
});

test('man literals preserve text without allowing roff requests or escapes',()=>{
 assert.equal(roffLiteral(".request\n'control\ntext \\escape - flag\nmid.line isn't a request"),
  "\\&.request\n\\&'control\ntext \\eescape \\- flag\nmid.line isn't a request");
});
