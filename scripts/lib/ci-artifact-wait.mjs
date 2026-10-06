/** Overlap prerequisite preparation with packaging without reusing another run or attempt.
 * API errors fail visibly; only an artifact not uploaded yet is polled. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
export async function waitForCurrentArtifact({startedAt,artifacts,jobs,now=Date.now,sleep:pause=sleep,timeout=180000,childFailed=()=>false}) {
 const start=Date.parse(startedAt),deadline=now()+timeout;
 if(!Number.isFinite(start))throw Error('Missing current-attempt start');
 while(now()<deadline){
  if(childFailed())throw Error('Standard-user bootstrap child failed before candidate arrival');
  const packing=(await jobs()).jobs.find(job=>job.name==='CLI npm pack');
  if(packing?.status==='completed'&&packing.conclusion!=='success')throw Error('CLI npm pack failed; no candidate can be accepted');
  const available=(await artifacts()).artifacts.filter(artifact=>artifact.name==='afbin-npm-release'&&!artifact.expired&&Date.parse(artifact.created_at)>=start);
  if(available.length>1)throw Error('Multiple current-attempt candidates');
  if(available.length===1)return available[0];
  await pause(5000);
 }
 throw Error('Current-attempt CLI artifact timed out');
}
export function verifyArtifactArchive(bytes,digest){
 const actual='sha256:'+createHash('sha256').update(bytes).digest('hex');
 if(!/^sha256:[a-f0-9]{64}$/.test(digest??'')||actual!==digest)throw Error('Current-run artifact archive checksum mismatch');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {
  const [repo,run,attempt,output,failedFile]=process.argv.slice(2);
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!/^\d+$/.test(run??'')||!/^\d+$/.test(attempt??'')||!output)throw Error('Pass repository, run, attempt and output zip');
  const api=(path)=>JSON.parse(execFileSync('gh',['api',`/repos/${repo}/actions/${path}`],{encoding:'utf8',timeout:30000}));
  const current=api(`runs/${run}/attempts/${attempt}`);
  const artifact=await waitForCurrentArtifact({startedAt:current.run_started_at,jobs:()=>api(`runs/${run}/attempts/${attempt}/jobs?per_page=100`),artifacts:()=>api(`runs/${run}/artifacts?per_page=100`),childFailed:()=>Boolean(failedFile&&existsSync(failedFile))});
  const bytes=execFileSync('gh',['api',`/repos/${repo}/actions/artifacts/${artifact.id}/zip`],{maxBuffer:64*1024*1024,timeout:30000});
  verifyArtifactArchive(bytes,artifact.digest);
  writeFileSync(output,bytes);
  console.log(`Downloaded same-run, same-attempt npm artifact ${artifact.id}`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
