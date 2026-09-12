import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {localSkillFiles,manPage,skillFilesFor} from '../src/teaching';
import {TEACHING_BASE,withTeachingOrigin} from '../src/teaching-origin';
import {DEFAULT_SERVER} from '../src/config';
import {installSkills,skillTargets} from '../src/skill-install';
import {commandHelp} from '../src/commands';
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
   const output:string[]=[];const context={cwd:root,home:root,env:{},interactive:false,stdout:(s:string)=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('bundled teaching must stay offline')};
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
 const context={cwd:root,home:root,env:{},interactive:false,stdout:(s:string)=>out.push(s),stderr:(s:string)=>problems.push(s),fetch:async()=>assert.fail('help must stay offline')};
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
  const manual=withTeachingOrigin(manPage(),DEFAULT_SERVER);
  assert.equal(written.format,'man');assert.equal(written.bytes,Buffer.byteLength(manual));
  assert.equal(await readFile(join(root,'afbin.1'),'utf8'),manual);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bare help prints the brief; help commands prints the command registry; both stay offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-help-brief-'));
 const context={cwd:root,home:root,env:{},interactive:false,fetch:async()=>assert.fail('help must stay offline')};
 try{
  const brief:string[]=[];
  assert.equal(await runCli(['help'],{...context,stdout:(s:string)=>brief.push(s),stderr:()=>{}}),0);
  const briefText=brief.join('');
  // Structural, not wording-pinned: the brief carries the skill headings and is not the command list.
  assert.match(briefText,/## Read first/);assert.match(briefText,/## Example/);
  assert.doesNotMatch(briefText,/^---/);
  assert.notEqual(briefText,commandHelp());
  const list:string[]=[];
  assert.equal(await runCli(['help','commands'],{...context,stdout:(s:string)=>list.push(s),stderr:()=>{}}),0);
  assert.equal(list.join(''),commandHelp());
  assert.match(list.join(''),/afbin push/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('man literals preserve text without allowing roff requests or escapes',()=>{
 assert.equal(roffLiteral(".request\n'control\ntext \\escape - flag\nmid.line isn't a request"),
  "\\&.request\n\\&'control\ntext \\eescape \\- flag\nmid.line isn't a request");
});

test('the compiled bundle names no server, and every copy is addressed to the one afbin was pointed at',async()=>{
 // A bundle that named one deployment would teach a self-hoster's agent to publish somewhere else.
 const corpus=Object.values(localSkillFiles).join('\n');
 for(const line of corpus.split('\n'))assert.doesNotMatch(line,/https?:\/\/[^\s`)'"]*artifactbin\.dev/,`the bundle addresses a deployment: ${line.trim().slice(0,120)}`);
 assert.ok(corpus.includes(`${TEACHING_BASE}/chat/install.sh`),'the installer address must survive compilation as the placeholder');

 const self='https://docs.self-hosted.example';
 const addressed=skillFilesFor(self);
 assert.ok(addressed['SKILL.md'].includes(`${self}/chat/install.sh`));
 assert.ok(!Object.values(addressed).join('\n').includes(TEACHING_BASE),'no placeholder may survive into an installed skill');
 assert.ok(addressed['references/errors.md'].includes(`${self}/chat/install.sh`),'the recovery catalogue is addressed too');

 const home=await mkdtemp(join(tmpdir(),'afbin-skill-origin-'));
 try{
  await installSkills(['pi'],{home,env:{},origin:self});
  const installed=await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8');
  assert.ok(installed.includes(`${self}/chat/install.sh`));
  assert.doesNotMatch(installed,/__AFBIN_SERVER__|artifactbin\.dev\/chat/);
  // Re-pointing the CLI at another server rewrites the installed skill rather than calling it current.
  await installSkills(['pi'],{home,env:{},origin:'https://other.example'});
  assert.ok((await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8')).includes('https://other.example/chat/install.sh'));
 }finally{await rm(home,{recursive:true,force:true});}

 // The terminal screens are the default HUMAN path and never take the plain-text branch.
 const screen:string[]=[];
 const screenRoot=await mkdtemp(join(tmpdir(),'afbin-help-screen-'));
 try{
  assert.equal(await runCli(['help'],{cwd:screenRoot,home:screenRoot,env:{ARTIFACTBIN_URL:self},interactive:true,color:false,stdout:(x:string)=>screen.push(x),stderr:()=>{},fetch:async()=>assert.fail('help must stay offline')}),0);
  assert.doesNotMatch(screen.join(''),/__AFBIN_SERVER__/);
  const topic:string[]=[];
  assert.equal(await runCli(['help','publishing-auth'],{cwd:screenRoot,home:screenRoot,env:{ARTIFACTBIN_URL:self},interactive:true,color:false,stdout:(x:string)=>topic.push(x),stderr:()=>{},fetch:async()=>assert.fail('help must stay offline')}),0);
  assert.ok(topic.join('').includes(`${self}/chat/install.sh`));
  assert.doesNotMatch(topic.join(''),/__AFBIN_SERVER__/);
 }finally{await rm(screenRoot,{recursive:true,force:true});}
});
