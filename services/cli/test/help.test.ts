/**
 * WHAT THE CLI TELLS YOU ABOUT ITSELF — the command registry, the screens rendered from it, the colour
 * that may only be added on top, the generated manual and the bundled teaching.
 *
 * This was four files (help-screen, commands, style, teaching) that all asserted the same thing from
 * different angles, plus two seeded cases about `--format man`. The invariant the whole surface rests on
 * is one line in what used to be teaching.test.ts: help formats, destinations and the manual come from
 * ONE command registry. So the registry is asserted once and every screen is checked by generating from
 * it — no case pins a rendered string that the registry already decides.
 */
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commands,commandHelp,parseCommand} from '../src/commands';
import {colorSupport,createStyle,stripAnsi,visibleWidth,highlightDiff,highlightJson} from '../src/style';
import {COMMAND_GROUPS,overviewScreen,commandScreen,summary} from '../src/help-screen';
import {briefDocument,helpTopics,helpDocument,localSkillFiles,manPage,skillFilesFor} from '../src/teaching';
import {TEACHING_BASE,withTeachingOrigin} from '../src/teaching-origin';
import {DEFAULT_SERVER} from '../src/config';
import {installSkills,skillTargets} from '../src/skill-install';
import {runCli} from '../src/dispatch';
import {CLI_VERSION} from '../src/version';
import {createTwoFilesPatch} from 'diff';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';
import {roffLiteral} from '../src/man';
import teaching from '../src/generated/teaching.json';


const ANSI=/\x1b\[/;
const plain={color:false as const,columns:100};
const lines=(text:string)=>text.split('\n');

test('the overview groups every command once, with the first clause of its description',()=>{
 const grouped=COMMAND_GROUPS.flatMap(([,names])=>names);
 assert.deepEqual([...grouped].sort(),commands.map(c=>c.name).sort());
 assert.equal(new Set(grouped).size,grouped.length);
 const text=overviewScreen(plain);
 assert.doesNotMatch(text,ANSI);
 assert.ok(text.startsWith(`afbin ${CLI_VERSION}\n`));
 assert.match(text,/^Artifactbin: Google docs for agents$/m);
 assert.match(text,/^Usage: afbin <command>/m);
 for(const [heading] of COMMAND_GROUPS)assert.match(text,new RegExp(`^${heading}:$`,'m'));
 for(const command of commands){
  const row=lines(text).find(line=>new RegExp(`^  ${command.name} {2,}`).test(line));
  assert.ok(row,command.name);
  assert.ok(row.includes(summary(command)),`${command.name}: ${row}`);
  assert.ok(!summary(command).includes(';'));
 }
 assert.match(text,/^Global options:$/m);
 for(const flag of ['--help','--version','--json','--server <URL>','--yes','--no-browser'])assert.ok(text.includes(flag),flag);
 assert.match(text,/<ref> = <url\|id\|path>\[@version\]/);
 assert.match(text,/afbin help brief/);
 assert.match(text,/afbin help <command>/);
});
test('colour adds escapes only: stripping them restores the plain screens exactly',()=>{
 for(const depth of ['truecolor','256','16'] as const){
  const styled=overviewScreen({color:true,depth,columns:100});
  assert.match(styled,ANSI);
  assert.equal(stripAnsi(styled),overviewScreen(plain));
  for(const command of commands)assert.equal(stripAnsi(commandScreen(command.name,{color:true,depth,columns:100})),commandScreen(command.name,plain));
 }
 assert.match(overviewScreen({color:true,depth:'truecolor',columns:100}),/\x1b\[38;2;\d+;\d+;\d+m/);
 assert.match(overviewScreen({color:true,depth:'256',columns:100}),/\x1b\[38;5;\d+m/);
 assert.doesNotMatch(overviewScreen({color:true,depth:'16',columns:100}),/\x1b\[38;[25];/);
});
test('the overview lists every bundled help topic, and each listed topic can be opened',()=>{
 const text=overviewScreen(plain).split('Help topics:')[1];
 assert.ok(text,'a discoverable help topic section');
 for(const topic of [...Object.keys(helpTopics),'brief']){
  assert.ok(text.split(/[\s,]+/).includes(topic),`missing topic ${topic}`);
  assert.ok(helpDocument(topic).length,`empty help ${topic}`);
 }
});
test('a command screen carries usage, every flag the parser accepts, and the examples',()=>{
 for(const command of commands){
  const text=commandScreen(command.name,plain);
  assert.doesNotMatch(text,ANSI);
  assert.ok(text.startsWith(`afbin ${command.name}\n`),command.name);
  assert.ok(text.replace(/\n/g,' ').includes(command.description),command.name);
  assert.ok(text.includes(`Usage: afbin ${command.name} ${command.usage}`.trimEnd()),command.name);
  for(const flag of command.flags)assert.match(text,new RegExp(`^ {2,6}(-[a-z], )?--${flag}( <[A-Z=]+>)?( |$)`,'m'),`${command.name} --${flag}`);
  for(const flag of ['--help','--version','--server <URL>','--yes','--no-browser'])assert.ok(text.includes(flag),`${command.name} ${flag}`);
  assert.equal(text.includes('--json'),command.name!=='remote',command.name);
  for(const example of command.examples)assert.ok(text.includes(`  ${example}`),example);
  assert.ok(text.includes('Examples:'));
  // The same registry drives `-h` and the plain-text help the non-interactive path prints.
  assert.equal(parseCommand([command.name,'-h']).flags.help,true);
  const help=commandHelp(command.name);
  assert.ok(help.includes(`afbin ${command.name}`));
  for(const flag of command.flags)assert.ok(help.includes(`--${flag}`),`${command.name}: ${flag}`);
 }
 assert.throws(()=>commandScreen('nope',plain),/unknown_help_topic|Unknown command/);
});

test('an unknown help topic names its nearest topics — `publish` (asked seven times in eval run 34694871143) points at the publishing set',()=>{
 assert.throws(()=>helpDocument('publish'),(error:unknown)=>{
  const e=error as {code:string;fix?:string};
  assert.equal(e.code,'unknown_help_topic');
  assert.match(e.fix??'',/Did you mean publishing, publishing-annotations, publishing-auth/);
  return true;
 });
 assert.throws(()=>helpDocument('zzqx'),(error:unknown)=>{
  const e=error as {code:string;fix?:string};
  assert.equal(e.code,'unknown_help_topic');
  assert.equal(e.fix,'Run afbin help.');
  return true;
 });
});
test('screens wrap to the terminal width with a hanging indent, and widen when there is room',()=>{
 for(const columns of [60,80]){
  // Examples are commands to copy, so they alone may run past the width.
  for(const text of [overviewScreen({...plain,columns}),commandScreen('pull',{...plain,columns}),commandScreen('comment',{...plain,columns})])
   for(const line of lines(text.split('Examples:')[0]))assert.ok(visibleWidth(line)<=columns,`${columns}: ${line}`);
 }
 const wide=commandScreen('pull',{...plain,columns:100});
 assert.ok(lines(wide).some(line=>line.includes('--dry-run')&&line.includes('remote state.')));
 const narrow=commandScreen('pull',{...plain,columns:60});
 assert.ok(!lines(narrow).some(line=>line.includes('--dry-run')&&line.includes('remote state.')));
});
test('colour support follows NO_COLOR, FORCE_COLOR, TERM and the stream',()=>{
 assert.deepEqual(colorSupport({NO_COLOR:'1',FORCE_COLOR:'1',COLORTERM:'truecolor'},true),{color:false});
 assert.deepEqual(colorSupport({},false),{color:false});
 assert.deepEqual(colorSupport({TERM:'dumb'},true),{color:false});
 assert.deepEqual(colorSupport({FORCE_COLOR:'1',TERM:'xterm'},false),{color:true,depth:'16'});
 assert.deepEqual(colorSupport({TERM:'xterm-256color'},true),{color:true,depth:'256'});
 assert.deepEqual(colorSupport({TERM:'xterm-256color',COLORTERM:'truecolor'},true),{color:true,depth:'truecolor'});
 const style=createStyle({color:false});
 assert.equal(style.bold('x'),'x');assert.equal(style.wordmark('afbin'),'afbin');
 assert.equal(stripAnsi(createStyle({color:true,depth:'truecolor'}).wordmark('afbin')),'afbin');
});
test('interactive help prints the screens; automation, --json and --output keep the brief and plain text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-help-screen-'));
 try{
  const out:string[]=[];const err:string[]=[];
  const base={cwd:root,home:root,env:{},stdout:(s:string)=>out.push(s),stderr:(s:string)=>err.push(s),fetch:async()=>assert.fail('help must stay offline')};
  const run=async(argv:string[],context:Record<string,unknown>)=>{out.length=0;err.length=0;const code=await runCli(argv,{...base,...context});return {code,text:out.join('')};};
  assert.deepEqual(await run(['help'],{interactive:true,columns:100}),{code:0,text:overviewScreen(plain)});
  assert.deepEqual(await run([],{interactive:true,columns:100}),{code:0,text:overviewScreen(plain)});
  assert.deepEqual(await run(['-h'],{interactive:true,columns:100}),{code:0,text:overviewScreen(plain)});
  assert.deepEqual(await run(['push','-h'],{interactive:true,columns:100}),{code:0,text:commandScreen('push',plain)});
  assert.deepEqual(await run(['help','push'],{interactive:true,columns:100}),{code:0,text:commandScreen('push',plain)});
  assert.deepEqual(await run(['help'],{interactive:true,color:true,columns:100}),{code:0,text:overviewScreen({color:true,depth:'16',columns:100})});
  assert.deepEqual(await run(['help'],{interactive:false}),{code:0,text:briefDocument()});
  assert.deepEqual(await run(['push','-h'],{interactive:false}),{code:0,text:commandHelp('push')});
  assert.deepEqual(await run(['help','brief'],{interactive:true}),{code:0,text:briefDocument()});
  assert.deepEqual(await run(['help','brief'],{interactive:false}),{code:0,text:briefDocument()});
  assert.equal((await run(['help','brief','--format','man'],{interactive:true})).code,2);
  assert.deepEqual(await run(['help','--json'],{interactive:true,color:true}),{code:0,text:JSON.stringify({help:briefDocument()})+'\n'});
  assert.equal((await run(['help','--output','brief.md'],{interactive:true,color:true})).code,0);
  assert.equal(await readFile(join(root,'brief.md'),'utf8'),briefDocument());
  assert.deepEqual(await run(['help','commands'],{interactive:true}),{code:0,text:commandHelp()});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failures keep their code: message shape, coloured only when colour is on',async()=>{
 const err:string[]=[];
 const context={cwd:tmpdir(),home:tmpdir(),env:{},interactive:false,stdout:()=>{},stderr:(s:string)=>err.push(s)};
 assert.equal(await runCli(['nope'],context),2);
 assert.equal(err.join(''),'unknown_command: Unknown command nope.\nRun afbin -h.\n');
 err.length=0;
 assert.equal(await runCli(['nope'],{...context,color:true}),2);
 assert.match(err.join(''),ANSI);
 assert.equal(stripAnsi(err.join('')),'unknown_command: Unknown command nope.\nRun afbin -h.\n');
});

describe('the command registry', () => {
  test('one flag vocabulary works before or after the command and aliases normalize',()=>{
   assert.deepEqual(parseCommand(['--json','push','a.jsx','-ny']),{command:'push',positionals:['a.jsx'],flags:{json:true,'dry-run':true,yes:true}});
   for(const retired of ['ls','rm','api'])assert.throws(()=>parseCommand([retired,'x']),/unknown_command|Unknown command/);
   assert.deepEqual(parseCommand(['update','--harness','pi','--harness=opencode','-y']).flags,{harness:['pi','opencode'],yes:true});
   assert.deepEqual(parseCommand(['remote','--name','Work','pi','--model','deepseek','-h']).positionals,['pi','--model','deepseek','-h']);
   assert.deepEqual(parseCommand(['push','--','-report.jsx']).positionals,['-report.jsx']);
  });
  test('refuses inapplicable flags and malformed requests before any auth or network',()=>{
   for(const args of [['status','--force'],['help','--dry-run'],['push','--fix'],['pull','--output','one','--output','two'],['list','--limit','0'],['list','--limit','no'],['api'],['comment','a','--state','resolved'],['comment','a','--body','x','--input','x'],['update','--harness','none','--harness','pi'],['auth','--harness','pi'],['push','--froce'],['push','--json=false']]) assert.throws(()=>parseCommand(args),Error,args.join(' '));
   assert.equal(parseCommand([]).command,'help');
   for(const args of [
    ['comment','abc123','--body','text','--node','heading','--limit','3'],
    ['comment','abc123','--thread','thread','--state','resolved','--cursor','next'],
    ['remote','--json','pi'],
   ])assert.throws(()=>parseCommand(args),Error,args.join(' '));
  });
  test('fixed choices ignore ASCII case but commands, flags and user arguments retain exact spelling',()=>{
   assert.deepEqual(parseCommand(['update','--harness','CoDeX','--harness','PI']).flags.harness,['codex','pi']);
   assert.throws(()=>parseCommand(['update','--harness','NONE','--harness','pi']));
   assert.throws(()=>parseCommand(['update','--harness','pi','--harness','PI']));
   assert.throws(()=>parseCommand(['AUTH']));
   assert.throws(()=>parseCommand(['update','--HARNESS','pi']));
   assert.deepEqual(parseCommand(['push','MiXeD.jsx']).positionals,['MiXeD.jsx']);
  });
});

describe('colour and highlighting', () => {
  const ANSI=/\x1b\[/;
  test('json and diff highlighting add escapes only, and never recolour text inside strings',()=>{
   const s=createStyle({color:true,depth:'16'});const plain=createStyle({color:false});
   const json=JSON.stringify({id:'abc123',count:2,ok:true,none:null,nested:{note:'x: true 1 null',ratio:-1500}},null,2);
   assert.equal(highlightJson(json,plain),json);
   const lit=highlightJson(json,s);
   assert.equal(stripAnsi(lit),json);
   assert.ok(lit.includes('\x1b[36m"id"\x1b[0m:'));
   assert.ok(lit.includes('\x1b[32m"abc123"\x1b[0m'));
   assert.ok(lit.includes('\x1b[33m2\x1b[0m')&&lit.includes('\x1b[33m-1500\x1b[0m'));
   assert.ok(lit.includes('\x1b[35mtrue\x1b[0m')&&lit.includes('\x1b[35mnull\x1b[0m'));
   assert.ok(lit.includes('\x1b[32m"x: true 1 null"\x1b[0m'));
   const patch=createTwoFilesPatch('base/a.jsx','local/a.jsx','<p>a</p>\n-- keep\n','<p>b</p>\n-- keep\n','last observed','local');
   assert.equal(highlightDiff(patch,plain),patch);
   const coloured=highlightDiff(patch,s);
   assert.equal(stripAnsi(coloured),patch);
   let seen={header:0,hunk:0,add:0,remove:0};
   for(const line of coloured.split('\n')){
    const bare=stripAnsi(line);
    if(/^(---|\+\+\+) /.test(bare)){seen.header++;assert.ok(line.startsWith('\x1b[1m'),line);}
    else if(bare.startsWith('@@')){seen.hunk++;assert.ok(line.startsWith('\x1b[36m'),line);}
    else if(bare.startsWith('+')){seen.add++;assert.ok(line.startsWith('\x1b[32m'),line);}
    else if(bare.startsWith('-')){seen.remove++;assert.ok(line.startsWith('\x1b[31m'),line);}
    else if(bare.startsWith(' '))assert.doesNotMatch(line,ANSI);
   }
   assert.deepEqual(seen,{header:2,hunk:1,add:1,remove:1});
  });
  test('colour reaches results, tables and the version line only when enabled, and strips back to the plain text',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-style-'));
   try{
    await writeFile(join(root,'doc.jsx'),'<p>hello</p>');
    await writeFile(join(root,'Sales.CSV'),'Region,Amount\nEast,12\nWest,24\n');
    const run=async(argv:string[],color:boolean)=>{
     const out:string[]=[];const err:string[]=[];
     const code=await runCli(argv,{cwd:root,home:root,env:{},interactive:false,color,stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async()=>assert.fail('network during local command')});
     return {code,out:out.join(''),err:err.join('')};
    };
    const version=[await run(['--version'],false),await run(['--version'],true)];
    assert.equal(version[0].out,`afbin ${CLI_VERSION} (protocol ${CLI_PROTOCOL_VERSION})\n`);
    assert.match(version[1].out,ANSI);assert.equal(stripAnsi(version[1].out),version[0].out);
    const result=[await run(['validate','doc.jsx'],false),await run(['validate','doc.jsx'],true)];
    assert.equal(result[0].code,0,result[0].err);assert.doesNotThrow(()=>JSON.parse(result[0].out));
    assert.doesNotMatch(result[0].out,ANSI);assert.match(result[1].out,/\x1b\[36m"/);assert.equal(stripAnsi(result[1].out),result[0].out);
    const table=[await run(['query','Sales.CSV','--format','table'],false),await run(['query','Sales.CSV','--format','table'],true)];
    assert.equal(table[0].code,0,table[0].err);assert.equal(table[0].out,'Region  Amount\nEast    12\nWest    24\n');
    assert.ok(table[1].out.startsWith('\x1b[35m\x1b[1mRegion\x1b[0m\x1b[0m  '),table[1].out);assert.equal(stripAnsi(table[1].out),table[0].out);
    const json=await run(['validate','doc.jsx','--json'],true);
    assert.doesNotMatch(json.out,ANSI);assert.doesNotThrow(()=>JSON.parse(json.out));
   }finally{await rm(root,{recursive:true,force:true});}
  });
});

describe('the bundled teaching and the manual', () => {
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
   // The same rule over the GENERATED bundle, which is what ships: an agent must never be told to
   // install the CLI from a registry, or to fetch a skill from anywhere else.
   for(const [file,text] of Object.entries(teaching.files as Record<string,string>)){
    assert.ok(!/npm install -g|npx afbin|npm i -g/.test(text),`${file} teaches npm installation`);
    assert.ok(!/MCP|\/docs\/llm|skills\.download/.test(text),`${file} teaches a remote or MCP surface`);
   }
   assert.match(teaching.files['references/publishing-auth.md'],/\/chat\/install\.sh/);
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
    const writtenMan=await readFile(join(root,'afbin.1'),'utf8');
    assert.equal(writtenMan,manual);
    assert.match(writtenMan,/^\.TH /m);assert.match(writtenMan,/afbin export/);
    assert.ok(!writtenMan.includes('afbin api'),'the manual never documents a retired command');
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

});
