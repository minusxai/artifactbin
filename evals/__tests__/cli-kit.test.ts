import {mkdtempSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {materializeCli,stagedCliSource,platformBinary} from '../lib/cli-kit';
import {countDocsReads} from '../lib/docs-reads';
import {mkdirSync,writeFileSync} from 'node:fs';
it('stages the actual CLI outside the checkout and runs offline without creating credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'afbin-eval-cli-'));
 try{
  const bin=materializeCli(join(root,'bin'));
  const output=execFileSync(join(bin,'afbin'),['--version','--json'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},encoding:'utf8'});
  expect(JSON.parse(output)).toMatchObject({protocol:1});
  expect(statSync(join(bin,'afbin')).mode&0o777).toBe(0o755);
  expect(existsSync(join(root,'.artifactbin'))).toBe(false);
  expect(()=>materializeCli(join(root,'missing'),join(root,'absent'))).toThrow('Build the CLI');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('stages the platform binary when it exists — the .mjs cannot resolve DuckDB from a run home — and the bundle otherwise',()=>{
 const dist=mkdtempSync(join(tmpdir(),'afbin-eval-dist-'));
 try{
  mkdirSync(dist,{recursive:true});
  writeFileSync(join(dist,'afbin.mjs'),'// bundle');
  expect(stagedCliSource(dist)).toBe(join(dist,'afbin.mjs'));
  writeFileSync(platformBinary(dist),'#!/bin/sh\necho binary\n');
  expect(stagedCliSource(dist)).toBe(platformBinary(dist));
  const bin=materializeCli(join(dist,'bin'),stagedCliSource(dist));
  expect(execFileSync(join(bin,'afbin'),{encoding:'utf8'}).trim()).toBe('binary');
 }finally{rmSync(dist,{recursive:true,force:true});}
});
// Only where `build:binary` ran: the unit-test job builds the bundle alone, and the bundle is exactly the
// build that cannot resolve DuckDB from a run home — the eval workflows build the binary before a leg.
it.skipIf(!existsSync(platformBinary()))('the staged CLI can run a local-file query — the reason the binary is preferred',()=>{
 const root=mkdtempSync(join(tmpdir(),'afbin-eval-duck-'));
 try{
  const bin=materializeCli(join(root,'bin'));
  writeFileSync(join(root,'rows.csv'),'team,cups\neng,3\nops,4\n');
  writeFileSync(join(root,'q.sql'),'select sum(cups) as total from public.rows');
  const output=execFileSync(join(bin,'afbin'),['query','rows.csv','--input','q.sql','--json'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},encoding:'utf8'});
  expect(JSON.parse(output).results[0].rows[0]).toEqual({total:7});
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('counts local CLI help as reading guidance without counting writes',()=>{
 expect(countDocsReads([{name:'bash',input:{command:'afbin help markup'}},{name:'bash',input:{command:'afbin push -h'}},{name:'bash',input:{command:'afbin push report.jsx'}}])).toBe(2);
});
