import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {DEFAULT_SERVER,exportedServer,loadConnection,saveConnection} from '../src/config';

test('config set host saves a client default without starting or contacting a server',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-defaults-'));const output:string[]=[];
 try{
  const code=await runCli(['config','set','host','http://localhost:7445','--json'],{home,cwd:home,env:{},interactive:false,
   stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('config must remain offline')});
  assert.equal(code,0,output.join(''));
  assert.deepEqual(JSON.parse(await readFile(join(home,'.artifactbin/config.json'),'utf8')),{host:'http://localhost:7445'});
  assert.equal(await exportedServer(home,{}),'http://localhost:7445');
  assert.equal((await stat(join(home,'.artifactbin/config.json'))).mode&0o777,0o600);
  await assert.rejects(stat(join(home,'.artifactbin/server')),{code:'ENOENT'});
  await saveConnection({server:'https://example.com',token:'mx_other'},home,{});
  assert.equal(await exportedServer(home,{}),'http://localhost:7445','another host login cannot change the default');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('first login on an explicitly selected host never changes the cloud fallback',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-defaults-'));
 try{
  await saveConnection({server:'https://example.com',token:'mx_other'},home,{});
  assert.equal((await exportedServer(home,{}))??DEFAULT_SERVER,DEFAULT_SERVER);
  assert.equal(await loadConnection(undefined,home,{}),null);
  assert.equal((await loadConnection('https://example.com',home,{}))?.token,'mx_other');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('config get host reports the fallback without creating state',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-defaults-'));const output:string[]=[];
 try{
  assert.equal(await runCli(['config','get','host','--json'],{home,cwd:home,env:{},interactive:false,
   stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('config must remain offline')}),0);
  assert.deepEqual(JSON.parse(output.join('')),{host:DEFAULT_SERVER});
  await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('saved JSON output applies without a repeated flag',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-defaults-'));const output:string[]=[];
 try{
  const context={home,cwd:home,env:{},interactive:false,stdout:(s:string)=>output.push(s),stderr:()=>{}};
  assert.equal(await runCli(['config','set','output','json'],context),0);
  output.length=0;
  assert.equal(await runCli(['config','get','host'],context),0);
  assert.equal(output.join(''),JSON.stringify({host:DEFAULT_SERVER})+'\n');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('serve passes operator overrides without touching client defaults',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-team-command-'));const output:string[]=[];
 try{
  const context={home,cwd:home,env:{},interactive:false,stdout:(s:string)=>output.push(s),stderr:()=>{},team:async(options:import('../src/serve-config').ServeOptions)=>{
   assert.equal(options.config,'team.env');assert.equal(options.directory,'data');assert.equal(options.port,8123);assert.equal(options.dbUrl,'postgres://localhost/app');return 0;
  }};
  assert.equal(await runCli(['serve','--config','team.env','--dir','data','--port','8123','--db-url','postgres://localhost/app'],context),0,output.join(''));
  await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('serve ignores client defaults even when the client configuration is invalid',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-serve-isolation-'));
 try{
  await mkdir(join(home,'.artifactbin'));await writeFile(join(home,'.artifactbin/config.json'),'not json');
  const errors:string[]=[];
  const code=await runCli(['serve','--dir','team'],{home,cwd:home,env:{},team:async()=>0,stdout:()=>{},stderr:value=>errors.push(value)});
  assert.equal(code,0,errors.join(''));
 }finally{await rm(home,{recursive:true,force:true});}
});
