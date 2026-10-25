#!/usr/bin/env node
/** Required, same-attempt Company source components; never a prior-run cache claim. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,mkdtempSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSourceArchive,sourceInputHash,sourceDeadline,collectCurrentSourceArtifacts} from '../lib/source-artifacts.mjs';
import {requestCurrentArtifact} from '../lib/ci-artifact-wait.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),context=join(root,'deploy/company');
const COMPONENTS=['runtime-pcre2','runtime-tar','runtime-dash','runtime-expat','runtime-coreutils','runtime-ncurses','browser-xml','browser-cups','browser-sqlite','browser-xorg'];
const base='node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf';
const profile='company-trixie-chromium-v1';
const [command,componentOrOutput,outputArgument]=process.argv.slice(2);
const operationStarted=Date.now();
const repository=process.env.GITHUB_REPOSITORY,run=process.env.GITHUB_RUN_ID,attempt=process.env.GITHUB_RUN_ATTEMPT,source=process.env.GITHUB_SHA;
assert.ok(['produce','collect'].includes(command),'Expected produce or collect');
const receiptOutput=resolve(command==='produce'?outputArgument:componentOrOutput);mkdirSync(receiptOutput,{recursive:true});
writeFileSync(join(receiptOutput,'source-status.json'),JSON.stringify({status:'failure',phase:'initialization',operation_started_at:new Date().toISOString()})+'\n');
assert.match(repository??'',/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
assert.match(run??'',/^[1-9][0-9]*$/);assert.match(attempt??'',/^[1-9][0-9]*$/);assert.match(source??'',/^[a-f0-9]{40}$/);
const runMetadata=JSON.parse(await requestCurrentArtifact(['api',`/repos/${repository}/actions/runs/${run}/attempts/${attempt}`],{deadline:Date.now()+30_000}));
assert.equal(String(runMetadata.id),run);assert.equal(String(runMetadata.run_attempt),attempt);
const startedAt=runMetadata.run_started_at,deadline=sourceDeadline(startedAt,operationStarted);
assert.ok(deadline>Date.now(),'Original required-check deadline expired');
const inputHash=sourceInputHash(root,['deploy/company/Dockerfile','deploy/company/runtime-source','scripts/ci/company-source-artifacts.mjs','scripts/lib/source-artifacts.mjs']);
const platform=process.arch==='x64'?'linux/amd64':process.arch==='arm64'?'linux/arm64':null;assert.ok(platform&&process.platform==='linux','Unsupported source producer platform');
assert.ok(readFileSync(join(context,'Dockerfile'),'utf8').includes('FROM '+base+' AS runtime-source'),'Pinned source base changed');
const identity=component=>({component,input_sha256:inputHash,base,platform,profile,repository,run_id:run,run_attempt:attempt,source_sha:source,workflow_started_at:startedAt});
function execute(program,args,{cwd=root}={}){
 return new Promise((done,fail)=>{
  const remaining=deadline-Date.now();if(remaining<=0){fail(Error('Original source operation deadline expired'));return;}
  const child=spawn(program,args,{cwd,stdio:'inherit'}),timer=setTimeout(()=>child.kill('SIGKILL'),remaining);
  child.once('error',error=>{clearTimeout(timer);fail(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?done():fail(Error(`${program} failed (${signal??code})`));});
 });
}
function writeTree(directory,entries){
 mkdirSync(directory,{recursive:true});
 for(const entry of entries.filter(entry=>entry.target===undefined)){
  const file=join(directory,entry.name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,entry.bytes,{mode:entry.mode});chmodSync(file,entry.mode);
 }
 for(const entry of entries.filter(entry=>entry.target!==undefined)){
  const file=join(directory,entry.name);mkdirSync(dirname(file),{recursive:true});symlinkSync(entry.target,file);
 }
}
if(command==='produce'){
 const component=componentOrOutput;assert.ok(COMPONENTS.includes(component),'Unknown source component');assert.ok(outputArgument,'Missing source output directory');
 const output=resolve(outputArgument),scratch=mkdtempSync(join(tmpdir(),'company-source-'));
 mkdirSync(output,{recursive:true});let status='failure';
 try{
  // This timer includes export and receipt creation; it never resets after the build.
  await execute('docker',['build','--platform',platform,'--target','runtime-component-output','--build-arg',`SOURCE_COMPONENT=${component}`,'--output',`type=local,dest=${scratch}`,'.'],{cwd:context});
  const entries=readdirSync(scratch).sort().filter(name=>lstatSync(join(scratch,name)).isFile()).map(name=>({name,bytes:readFileSync(join(scratch,name)),mode:lstatSync(join(scratch,name)).mode&0o777}));
  assert.ok(entries.some(entry=>entry.name.endsWith('.deb')),'Source component emitted no packages');
  writeFileSync(join(output,component+'.tar'),buildSourceArchive(identity(component),entries));
  assert.ok(Date.now()<deadline,'Source export exceeded original deadline');status='success';
 }finally{
  writeFileSync(join(output,'source-status.json'),JSON.stringify({component,status,workflow_started_at:startedAt,operation_started_at:new Date(operationStarted).toISOString(),completed_at:new Date().toISOString(),operation_ms:Date.now()-operationStarted,deadline:new Date(deadline).toISOString()},null,2)+'\n');
  rmSync(scratch,{recursive:true,force:true});
 }
}else{
 const output=resolve(componentOrOutput);mkdirSync(output,{recursive:true});let status='failure';
 try{
  const identities=Object.fromEntries(COMPONENTS.map(component=>[component,identity(component)]));
  const components=await collectCurrentSourceArtifacts({repository,run,attempt,identities,deadline,artifactName:component=>'company-source-'+component,jobName:component=>'Company source ('+component+')'});
  const packages=join(output,'out'),tools=join(output,'test-tools');mkdirSync(packages);mkdirSync(tools);
  let browserProfile;
  for(const [component,entries] of components){
   const directory=join(output,'components',component);writeTree(directory,entries);
   for(const entry of entries.filter(entry=>entry.name.endsWith('.deb'))){
    const file=join(packages,entry.name);
    try{assert.deepEqual(readFileSync(file),entry.bytes,'Conflicting source package output');}catch(error){if(error.code!=='ENOENT')throw error;writeFileSync(file,entry.bytes);}
   }
   if(component.startsWith('browser-')){
    const captured=entries.find(entry=>entry.name==='browser-runtime-profile.tsv');assert.ok(captured,'Missing untouched browser profile');
    if(browserProfile)assert.deepEqual(captured.bytes,browserProfile,'Source producers captured different runtime profiles');else browserProfile=captured.bytes;
   }
  }
  writeFileSync(join(packages,'browser-runtime-profile.tsv'),browserProfile);
  if(!browserProfile.toString().split('\n').some(line=>line.split('\t')[0].split(':')[0]==='libncursesw6'))rmSync(join(packages,'libncursesw6.deb'),{force:true});
  for(const [component,name] of [['browser-xml','check-xml'],['browser-cups','check-ipp'],['browser-xorg','check-xorg'],['browser-xorg','check-display.sh']]){
   const entry=components.get(component).find(entry=>entry.name===name);assert.ok(entry,'Missing native source fixture');writeTree(tools,[entry]);
  }
  writeTree(join(tools,'sqlite'),components.get('browser-sqlite'));
  writeTree(tools,[{name:'verify-sqlite.sh',bytes:readFileSync(join(tools,'sqlite/verify-sqlite.sh')),mode:0o755},{name:'check-browser-libraries.mjs',bytes:readFileSync(join(context,'runtime-source/browser/check-browser-libraries.mjs')),mode:0o644}]);
  await execute(process.execPath,[join(context,'runtime-source/browser/write-payload-manifest.mjs'),packages,join(tools,'browser-native-payloads.json')]);
  writeFileSync(join(output,'Dockerfile'),'FROM scratch\nCOPY out/ /out/\nCOPY test-tools/ /test-tools/\n');
  await execute('docker',['build','-t','afbin-runtime-packages-ci',output]);status='success';
 }finally{
  writeFileSync(join(output,'source-status.json'),JSON.stringify({status,workflow_started_at:startedAt,operation_ms:Date.now()-operationStarted,deadline:new Date(deadline).toISOString()},null,2)+'\n');
 }
}
