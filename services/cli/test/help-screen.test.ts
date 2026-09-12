import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commands,commandHelp} from '../src/commands';
import {colorSupport,createStyle,stripAnsi,visibleWidth} from '../src/style';
import {COMMAND_GROUPS,overviewScreen,commandScreen,summary} from '../src/help-screen';
import {briefDocument,helpTopics,helpDocument} from '../src/teaching';
import {runCli} from '../src/dispatch';
import {CLI_VERSION} from '../src/version';

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
