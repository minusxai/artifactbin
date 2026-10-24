import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import YAML from 'yaml';
const execute=promisify(execFile);
const workflow=YAML.parse(await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const step=workflow.jobs['cli-pack'].steps.find(step=>step.name==='Prepare public downloads while building the CLI');
const driver=`
 const fs=require('fs'),p=require('path');const root=process.env.PRODUCER_FIXTURE_ROOT;
 const put=n=>fs.writeFileSync(p.join(root,n),'ready');
 const wait=async n=>{const end=Date.now()+3000;while(!fs.existsSync(p.join(root,n))){if(Date.now()>end)throw Error('Missing concurrent job: '+n);await new Promise(r=>setTimeout(r,5));}};
 (async()=>{
  const [program,...args]=process.argv.slice(2);
  if(program==='npm'){
   if(args.join(' ')!=='run build -w services/cli')throw Error('Unexpected build');
   put('build-start');await wait('compiler-start');
   if(process.env.PLATFORM_SEEDS_REQUIRED==='true'&&process.env.SEED_CACHE_HIT!=='true')await wait('seed-start');
   put('build-finished');return;
  }
  if(args[0]==='scripts/ci/prepare-esbuild.mjs'){
   if(args.slice(1).join(' ')!=='--cache-package')throw Error('Background producer must not install or stage binaries');
   put('compiler-start');await wait('build-start');await wait('build-finished');
   await new Promise(r=>setTimeout(r,30));if(process.env.FAIL_COMPILER)process.exit(17);
   put('compiler-finished');return;
  }
  if(args[0]==='services/cli/scripts/npm-dependency-cache.mjs'&&args[1]==='prepare-seed'){
   put('seed-start');await wait('build-finished');if(process.env.FAIL_SEED)process.exit(19);put('seed-finished');return;
  }
  throw Error('Unexpected producer command');
 })().catch(e=>{console.error(e);process.exitCode=1;});
`;
async function fixture(settings,run){
 const root=await mkdtemp(join(tmpdir(),'compiler-producer-'));
 try{
  await mkdir(join(root,'bin'));await writeFile(join(root,'driver.cjs'),driver);
  const node=process.execPath.replaceAll("'","'\\''");
  for(const program of ['node','npm'])await writeFile(join(root,'bin',program),`#!/bin/sh\nexec '${node}' "$PRODUCER_FIXTURE_ROOT/driver.cjs" ${program} "$@"\n`,{mode:0o755});
  const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,PRODUCER_FIXTURE_ROOT:root,RUNNER_TEMP:root,PLATFORM_SEEDS_REQUIRED:'true',SEED_CACHE_HIT:'false',...settings};
  let code=0;
  try{await execute('/bin/bash',['-e','-o','pipefail','-c',step.run],{cwd:root,env,timeout:10000});}catch(error){code=error.code;}
  await run(root,code);
 }finally{await rm(root,{recursive:true,force:true});}
}
it.each([{},{SEED_CACHE_HIT:'true'},{PLATFORM_SEEDS_REQUIRED:'false'}])('overlaps cache-only compilers with build, joins all selected producers: %j',settings=>fixture(settings,async(root,code)=>{
 expect(code).toBe(0);await access(join(root,'compiler-finished'));await access(join(root,'build-finished'));
 if(settings.SEED_CACHE_HIT==='true'||settings.PLATFORM_SEEDS_REQUIRED==='false')await expect(access(join(root,'seed-start'))).rejects.toThrow();
 else await access(join(root,'seed-finished'));
}));
it.each([['FAIL_COMPILER',17],['FAIL_SEED',19]])('propagates %s after joining instead of packing incomplete assets',(flag,expected)=>fixture({[flag]:'true'},async(_root,code)=>{
 expect(code).toBe(expected);
}));
