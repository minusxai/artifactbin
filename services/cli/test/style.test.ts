import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTwoFilesPatch} from 'diff';
import {createStyle,highlightDiff,highlightJson,stripAnsi} from '../src/style';
import {runCli} from '../src/dispatch';
import {CLI_VERSION} from '../src/version';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';

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
