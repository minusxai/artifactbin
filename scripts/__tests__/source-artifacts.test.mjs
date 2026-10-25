import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildSourceArchive,readSourceArchive,sourceDeadline,collectCurrentSourceArtifacts} from '../lib/source-artifacts.mjs';
const identity={component:'browser-sqlite',input_sha256:'a'.repeat(64),base:'node@sha256:'+'b'.repeat(64),platform:'linux/amd64',profile:'company-browser-v1',repository:'example/project',run_id:'123',run_attempt:'2',source_sha:'c'.repeat(40),workflow_started_at:'2026-10-25T00:00:00Z'};
it('binds nested package/proof bytes, executable modes and exact attempt identity',()=>{
 const bytes=buildSourceArchive(identity,[{name:'libsqlite3.deb',bytes:Buffer.from('package'),mode:0o644},{name:'proof/check',bytes:Buffer.from('native'),mode:0o755}]);
 const entries=readSourceArchive(bytes,identity);
 expect(entries.map(entry=>[entry.name,entry.bytes.toString(),entry.mode])).toEqual([['libsqlite3.deb','package',0o644],['proof/check','native',0o755]]);
 for(const patch of [{run_attempt:'1'},{source_sha:'d'.repeat(40)},{platform:'linux/arm64'},{profile:'other'},{input_sha256:'e'.repeat(64)}])expect(()=>readSourceArchive(bytes,{...identity,...patch})).toThrow('identity');
 const changed=Buffer.from(bytes);const offset=changed.indexOf(Buffer.from('native'));changed[offset]^=1;
 expect(()=>readSourceArchive(changed,identity)).toThrow('payload');
});
it('refuses traversal, duplicate paths and escaping links',()=>{
 for(const name of ['../bad','/absolute','nested/../../bad','a\\bad','./alias'])expect(()=>buildSourceArchive(identity,[{name,bytes:Buffer.from('x'),mode:0o644}])).toThrow();
 expect(()=>buildSourceArchive(identity,[{name:'a',bytes:Buffer.from('1'),mode:0o644},{name:'a',bytes:Buffer.from('2'),mode:0o644}])).toThrow('Duplicate');
 expect(()=>buildSourceArchive(identity,[{name:'proof/link',target:'../../escape',mode:0o777}])).toThrow('link');
});
it('retains the 300 second source cap inside the original 480 second workflow deadline',()=>{
 const start=Date.parse(identity.workflow_started_at);
 expect(sourceDeadline(identity.workflow_started_at,start+10_000)).toBe(start+310_000);
 expect(sourceDeadline(identity.workflow_started_at,start+400_000)).toBe(start+480_000);
 expect(sourceDeadline(identity.workflow_started_at,start+490_000)).toBe(start+480_000);
 expect(()=>sourceDeadline('invalid',start)).toThrow();
});

it('fails closed on a required producer failure and cannot reset source readiness past the chain',async()=>{
 const started=Date.parse(identity.workflow_started_at);let now=started+470_000,calls=0;
 const identities={[identity.component]:identity};
 const request=async args=>{calls++;return JSON.stringify(args[1].includes('/jobs')?{jobs:[{id:101,name:'producer',status:'completed',conclusion:'failure'}]}:{artifacts:[]});};
 await expect(collectCurrentSourceArtifacts({repository:identity.repository,run:identity.run_id,attempt:identity.run_attempt,identities,artifactName:()=> 'artifact',jobName:()=> 'producer',request,now:()=>now,pause:async ms=>{now+=ms;}})).rejects.toThrow('producer failed');
 const pending=async args=>JSON.stringify(args[1].includes('/jobs')?{jobs:[]}:{artifacts:[]});
 await expect(collectCurrentSourceArtifacts({repository:identity.repository,run:identity.run_id,attempt:identity.run_attempt,identities,artifactName:()=> 'artifact',jobName:()=> 'producer',request:pending,now:()=>now,pause:async ms=>{now+=ms;}})).rejects.toThrow('timed out');
 expect(now).toBe(started+480_000);expect(calls).toBe(2);
});

it('does not admit an uploaded artifact until its required producer succeeds',async()=>{
 const started=Date.parse(identity.workflow_started_at);let now=started+479_000;
 const request=async args=>{
  expect(args[1]).not.toContain('/actions/artifacts/');
  return JSON.stringify(args[1].includes('/jobs')?{jobs:[{id:101,name:'producer',status:'in_progress',conclusion:null}]}:{artifacts:[{id:12,name:'artifact',expired:false,created_at:identity.workflow_started_at}]});
 };
 await expect(collectCurrentSourceArtifacts({repository:identity.repository,run:identity.run_id,attempt:identity.run_attempt,identities:{[identity.component]:identity},artifactName:()=> 'artifact',jobName:()=> 'producer',request,now:()=>now,pause:async ms=>{now+=ms;}})).rejects.toThrow('timed out');
 expect(now).toBe(started+480_000);
});

it('records producer failure before setup errors and never starts a build on invalid run metadata',()=>{
 const directory=mkdtempSync(join(tmpdir(),'source-status-'));
 try{
  const bin=join(directory,'bin'),output=join(directory,'output');mkdirSync(bin);
  writeFileSync(join(bin,'gh'),`#!/bin/sh\nprintf '%s\\n' '{"id":999,"run_attempt":2}'\n`,{mode:0o755});
  const result=spawnSync(process.execPath,[new URL('../ci/company-source-artifacts.mjs',import.meta.url).pathname,'produce','runtime-pcre2',output],{env:{...process.env,PATH:bin+':'+process.env.PATH,GITHUB_REPOSITORY:identity.repository,GITHUB_RUN_ID:identity.run_id,GITHUB_RUN_ATTEMPT:identity.run_attempt,GITHUB_SHA:identity.source_sha},encoding:'utf8'});
  expect(result.status).not.toBe(0);
  expect(JSON.parse(readFileSync(join(output,'source-status.json'),'utf8'))).toMatchObject({status:'failure',phase:'initialization'});
  expect(result.stderr).toContain('999');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('admits verified ZIP and nested source payloads from pages beyond the first hundred',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'source-pages-'));
 try{
  const bytes=buildSourceArchive(identity,[{name:'proof/native',bytes:Buffer.from('actual payload'),mode:0o755}]);
  const tar=join(directory,identity.component+'.tar'),zip=join(directory,'artifact.zip');writeFileSync(tar,bytes);
  const standard=join(directory,'standard-tar');mkdirSync(standard);
  execFileSync('tar',['-xf',tar,'-C',standard]);
  expect(readFileSync(join(standard,'proof/native'),'utf8')).toBe('actual payload');
  expect(statSync(join(standard,'proof/native')).mode&0o777).toBe(0o755);
  execFileSync('zip',['-q','-j',zip,tar]);const archive=readFileSync(zip);
  const calls=[],deadline=Date.parse(identity.workflow_started_at)+300_000;
  const request=async(args,options)=>{
   calls.push(args[1]);expect(options.deadline).toBe(deadline);
   if(args[1].includes('/actions/artifacts/2101/zip'))return archive;
   const second=args[1].endsWith('&page=2'),jobs=args[1].includes('/jobs');
   return JSON.stringify(jobs?{total_count:101,jobs:second?[{id:101,name:'producer',status:'completed',conclusion:'success'}]:Array.from({length:100},(_,i)=>({id:i+1,name:'other-'+i}))}:{total_count:101,artifacts:second?[{id:2101,name:'artifact',expired:false,created_at:identity.workflow_started_at,digest:'sha256:'+createHash('sha256').update(archive).digest('hex'),size_in_bytes:archive.length}]:Array.from({length:100},(_,i)=>({id:1001+i,name:'other-'+i}))});
  };
  const result=await collectCurrentSourceArtifacts({repository:identity.repository,run:identity.run_id,attempt:identity.run_attempt,identities:{[identity.component]:identity},artifactName:()=> 'artifact',jobName:()=> 'producer',request,now:()=>Date.parse(identity.workflow_started_at),deadline});
  expect(result.get(identity.component)[0]).toMatchObject({name:'proof/native',mode:0o755});
  expect(result.get(identity.component)[0].bytes.toString()).toBe('actual payload');
  expect(calls.filter(path=>path.endsWith('&page=2'))).toHaveLength(2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it('rejects repeated API identities across pages instead of counting duplicates as evidence',async()=>{
 const request=async args=>JSON.stringify(args[1].includes('/jobs')?{jobs:[{id:101,name:'producer',status:'completed',conclusion:'success'}]}:{total_count:101,artifacts:args[1].endsWith('&page=2')?[{id:1,name:'duplicate'}]:Array.from({length:100},(_,i)=>({id:i+1,name:'other-'+i}))});
 await expect(collectCurrentSourceArtifacts({repository:identity.repository,run:identity.run_id,attempt:identity.run_attempt,identities:{[identity.component]:identity},artifactName:()=> 'artifact',jobName:()=> 'producer',request,now:()=>Date.parse(identity.workflow_started_at)})).rejects.toThrow('Duplicate current-attempt item identity');
});
