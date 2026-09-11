import {createServer} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node-pty';
const require=createRequire(import.meta.url);
const main=fileURLToPath(new URL('../src/main.ts',import.meta.url));
test('real terminal checklist defaults detected harnesses, remembers opt-outs and permits changing selection',{timeout:20000},async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-checklist-'));const bin=join(home,'bin');
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({artifacts:[]}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  await mkdir(bin);for(const name of ['pi','opencode'])await writeFile(join(bin,name),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const invoke=(keys:string,expected:string)=>new Promise<string>((resolve,reject)=>{
   const child=spawn(process.env.AFBIN_TEST_BINARY??process.execPath,[...(process.env.AFBIN_TEST_BINARY?[]:['--import',require.resolve('tsx'),main]),'setup','--json'],{cwd:home,cols:180,rows:30,env:{HOME:home,PATH:bin,TSX_TSCONFIG_PATH:fileURLToPath(new URL('../../../tsconfig.json',import.meta.url)),ARTIFACTBIN_TOKEN:'test_token',ARTIFACTBIN_URL:origin,TERM:'xterm-256color'}});
   let output='',sent=false;const timeout=setTimeout(()=>{child.kill();reject(new Error('Checklist timed out: '+output));},8000);
   child.onData(data=>{output+=data;if(!sent&&output.includes('opencode:')){sent=true;try{assert.match(output,new RegExp(expected));child.write(keys);}catch(error){child.kill();reject(error);}}});
   child.onExit(event=>{clearTimeout(timeout);try{assert.equal(event.exitCode,0,output);resolve(output);}catch(error){reject(error);}});
  });
  // Move from Claude to pi, disable it; move to OpenCode, disable it; confirm.
  await invoke('\x1b[B\x1b[B \x1b[B \r','\\[x\\] pi:');
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin','settings.json'),'utf8')).harnesses,[]);
  await assert.rejects(stat(join(home,'.pi','agent','skills','artifactbin')),{code:'ENOENT'});
  await invoke('\x1b[B\x1b[B \r','\\[ \\] pi:');
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin','settings.json'),'utf8')).harnesses,['pi']);
  assert.match(await readFile(join(home,'.pi','agent','skills','artifactbin','SKILL.md'),'utf8'),/name: artifactbin/);
 }finally{server.close();await rm(home,{recursive:true,force:true});}
});
