/** Overlap prerequisite preparation with packaging without reusing another run or attempt.
 * Only bounded transport failures retry; API/schema errors fail visibly. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,win32 as windowsPath} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const artifactTimeout=()=>Error('Current-attempt artifact timed out');
export const MAX_ARTIFACT_ARCHIVE_BYTES=128*1024*1024;
/** Three transport attempts share the caller's original readiness deadline.
 * Transient GitHub HTTP failures are read-only API failures, not schema or auth failures. */
export async function requestCurrentArtifact(args,{deadline,now=Date.now,sleep:pause=sleep,request=execFileSync,command='gh',requestTimeout=30000,retryDelay=1000,encoding='utf8',maxBuffer=1024*1024}){
 for(let attempt=0;attempt<3;attempt++){
  const remaining=deadline-now();
  if(remaining<=0)throw artifactTimeout();
  try{
   const result=request(command,args,{encoding,maxBuffer,timeout:Math.max(1,Math.min(requestTimeout,remaining))});
   if(now()>=deadline)throw artifactTimeout();
   return result;
  }catch(error){
   const transientHttp=error.status===1&&/\bHTTP (?:429|500|502|503|504)\b/.test(String(error.stderr??''));
   if(!['ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(error.code)&&!transientHttp)throw error;
   if(now()>=deadline)throw artifactTimeout();
   if(attempt===2)throw error;
   await pause(Math.min(retryDelay,deadline-now()));
  }
 }
}
export async function waitForCurrentArtifact({startedAt,artifacts,jobs,now=Date.now,sleep:pause=sleep,timeout=180000,deadline=now()+timeout,childFailed=()=>false,jobName='CLI npm pack',artifactName='afbin-npm-release'}) {
 const start=Date.parse(startedAt);
 if(!Number.isFinite(start))throw Error('Missing current-attempt start');
 while(now()<deadline){
  if(childFailed())throw Error('Standard-user bootstrap child failed before candidate arrival');
  const packing=(await jobs()).jobs.find(job=>job.name===jobName);
  if(now()>=deadline)throw artifactTimeout();
  if(packing?.status==='completed'&&packing.conclusion!=='success')throw Error(`${jobName} failed; no candidate can be accepted`);
  const available=(await artifacts()).artifacts.filter(artifact=>artifact.name===artifactName&&!artifact.expired&&Date.parse(artifact.created_at)>=start);
  if(now()>=deadline)throw artifactTimeout();
  if(available.length>1)throw Error('Multiple current-attempt candidates');
  if(available.length===1)return available[0];
  await pause(Math.min(5000,deadline-now()));
 }
 throw artifactTimeout();
}
export function verifyArtifactArchive(bytes,digest){
 const actual='sha256:'+createHash('sha256').update(bytes).digest('hex');
 if(!/^sha256:[a-f0-9]{64}$/.test(digest??'')||actual!==digest)throw Error('Current-run artifact archive checksum mismatch');
}
export async function downloadCurrentArtifactArchive(artifact,{repo,deadline,request=requestCurrentArtifact}={}){
 if(Number.isFinite(artifact.size_in_bytes)&&artifact.size_in_bytes>MAX_ARTIFACT_ARCHIVE_BYTES)throw Error(`Current-run artifact archive exceeds ${MAX_ARTIFACT_ARCHIVE_BYTES} byte download limit`);
 const bytes=await request(['api',`/repos/${repo}/actions/artifacts/${artifact.id}/zip`],{deadline,encoding:null,maxBuffer:MAX_ARTIFACT_ARCHIVE_BYTES});
 verifyArtifactArchive(bytes,artifact.digest);
 return bytes;
}
/** Extract exactly one bounded regular file from an already verified Actions ZIP. */
export function extractSingleArtifactFile(archivePath,memberName,outputPath,{execute=execFileSync,write=writeFileSync,deadline,now=Date.now,platform=process.platform,systemRoot=process.env.SystemRoot??'C:\\Windows'}={}){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(memberName??''))throw Error('Current-run artifact member name refused');
 const windows=platform==='win32',command=windows?windowsPath.join(systemRoot,'System32','tar.exe'):'unzip';
 const listArgs=windows?['-tf',archivePath]:['-Z1',archivePath];
 const extractArgs=windows?['-xOf',archivePath,memberName]:['-p',archivePath,memberName];
 const options=(encoding,maxBuffer)=>{
  const timeout=deadline===undefined?undefined:deadline-now();
  if(timeout!==undefined&&timeout<=0)throw artifactTimeout();
  return {encoding,maxBuffer,...(timeout===undefined?{}:{timeout:Math.ceil(timeout)})};
 };
 const listing=execute(command,listArgs,options('utf8',64*1024)).toString();
 const members=listing.split(/\r?\n/).filter(Boolean);
 if(members.length!==1||members[0]!==memberName)throw Error(`Current-run artifact ZIP must contain exactly one member named ${memberName}`);
 const bytes=execute(command,extractArgs,options(null,MAX_ARTIFACT_ARCHIVE_BYTES));
 if(bytes.length>MAX_ARTIFACT_ARCHIVE_BYTES)throw Error(`Current-run artifact member exceeds ${MAX_ARTIFACT_ARCHIVE_BYTES} byte extraction limit`);
 write(outputPath,bytes);
 return bytes.length;
}
export async function downloadAndExtractCurrentArtifactFile(artifact,{repo,deadline,request=requestCurrentArtifact,memberName,outputPath,execute=execFileSync,now=Date.now}={}){
 const bytes=await downloadCurrentArtifactArchive(artifact,{repo,deadline,request});
 const directory=mkdtempSync(join(tmpdir(),'afbin-verified-artifact-'));
 try{
  const archivePath=join(directory,'artifact.zip');writeFileSync(archivePath,bytes);
  return extractSingleArtifactFile(archivePath,memberName,outputPath,{execute,deadline,now});
 }finally{rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {
  const args=process.argv.slice(2),waitOnly=args[0]==='--wait-only',extract=args[0]==='--extract';
  if(waitOnly||extract)args.shift();
  const [repo,run,attempt,...rest]=args;
  let output;
  let failedFile,downloadName,memberName,extractedPath;
  if(extract)[downloadName,memberName,extractedPath]=rest;
  else [output,failedFile,downloadName]=rest;
  const artifactName=waitOnly?(output??'afbin-npm-release'):(downloadName??'afbin-npm-release');
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!/^\d+$/.test(run??'')||!/^\d+$/.test(attempt??'')||(!waitOnly&&!extract&&!output)||! /^[\w.-]+$/.test(artifactName)||(extract&&(!memberName||!extractedPath)))throw Error('Pass repository, run, attempt and output zip (or --wait-only with optional artifact name; downloads default to afbin-npm-release; --extract also needs an artifact name, one member name and destination)');
  const deadline=Date.now()+180000;
  const api=async(path)=>JSON.parse(await requestCurrentArtifact(['api',`/repos/${repo}/actions/${path}`],{deadline}));
  const current=await api(`runs/${run}/attempts/${attempt}`);
  const artifact=await waitForCurrentArtifact({deadline,artifactName,startedAt:current.run_started_at,jobs:()=>api(`runs/${run}/attempts/${attempt}/jobs?per_page=100`),artifacts:()=>api(`runs/${run}/artifacts?per_page=100`),childFailed:()=>Boolean(failedFile&&existsSync(failedFile))});
  if(waitOnly){
   console.log(`Ready: same-run, same-attempt npm artifact ${artifact.id}`);
  }else if(extract){
   const length=await downloadAndExtractCurrentArtifactFile(artifact,{repo,deadline,memberName,outputPath:extractedPath});
   console.log(`Extracted ${memberName} (${length} bytes) from verified same-run, same-attempt ${artifactName} artifact ${artifact.id}`);
  }else{
  const bytes=await downloadCurrentArtifactArchive(artifact,{repo,deadline});
  writeFileSync(output,bytes);
  console.log(`Downloaded same-run, same-attempt ${artifactName} artifact ${artifact.id}`);
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
