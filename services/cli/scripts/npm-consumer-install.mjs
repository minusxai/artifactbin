/** Fresh native npm installation: seeded CI installs cannot revalidate on the network.
 * Keep lifecycle scripts enabled, stream npm phase timings, and settle only after child cleanup. */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {basename} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Writable} from 'node:stream';

async function sha256File(path,deadline,now){
 const remaining=deadline-now();
 if(remaining<=0)throw Error('install deadline elapsed before candidate hashing');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('install deadline elapsed during candidate hashing')),remaining);
 const hash=createHash('sha256');
 try{
  for await(const chunk of createReadStream(path,{signal:controller.signal}))hash.update(chunk);
  return hash.digest('hex');
 }finally{clearTimeout(timer);}
}

async function assertGzip(path,deadline,now){
 const remaining=deadline-now();
 if(remaining<=0)throw Error('install deadline elapsed before candidate gzip validation');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('install deadline elapsed during candidate gzip validation')),remaining);
 try{
  await pipeline(createReadStream(path),createGunzip(),new Writable({write(_chunk,_encoding,callback){callback();}}),{signal:controller.signal});
 }finally{clearTimeout(timer);}
}

function isCandidateEof(output,name){
 const eof=/\bZ_BUF_ERROR\b|zlib:\s*unexpected end of file/i.test(output);
 const candidateName=output.includes(name);
 const bundledAssets=/TAR_ENTRY_ERROR[^\r\n]*dist[\\/]+runtime[\\/]+dist[\\/]+web[\\/]+assets/i.test(output);
 const errorCodes=[...output.matchAll(/\bnpm error code\s+([A-Z0-9_]+)\b/gi)].map(match=>match[1].toUpperCase());
 const unrelatedNpmError=errorCodes.some(code=>code!=='Z_BUF_ERROR')||/\bnpm error command failed\b/i.test(output);
 return eof&&(candidateName||bundledAssets)&&!unrelatedNpmError;
}

export async function installNpmConsumer({npm,tarball,cwd,env,seeded=false,onOutput=chunk=>process.stdout.write(chunk),timeoutMs=300000,heartbeatMs=15000,now=()=>performance.now(),attemptRunner}){
 const started=now(),deadline=started+timeoutMs,name=basename(tarball);
 // The candidate marker is retained with native CI logs so an extraction failure can be
 // attributed to these exact bytes. Dependency cache entries are not included here.
 const initialDigest=seeded?await sha256File(tarball,deadline,now):null;
 let output='';
 const emit=text=>{output+=text;onOutput(text);};
 const diagnostic=text=>emit(`${output&&!output.endsWith('\n')?'\n':''}${text}`);
 if(initialDigest)diagnostic(`Npm consumer candidate: ${name} sha256=${initialDigest}\n`);
 // npm cache add stores full packuments; request the same representation offline.
 const args=[npm,'install',...(seeded?['--offline','--full-metadata']:[]),'--foreground-scripts','--no-audit','--no-fund','--timing',tarball];
 // Injection keeps deadline scheduling independently testable; native execution is the default.
 const runAttempt=async(attempt)=>{
  const remaining=deadline-now();
  if(remaining<=0)return {timedOut:true,output:'',code:null,signal:null,seconds:0};
  if(attemptRunner){
   const result=await attemptRunner({attempt,timeoutMs:remaining,args,cwd,env});
   if(result.output)emit(result.output);
   return result;
  }
  return new Promise((resolve,reject)=>{
  const attemptStarted=now();
  const child=spawn(process.execPath,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let attemptOutput='',timedOut=false;
  const collect=chunk=>{const text=chunk.toString();attemptOutput+=text;emit(text);};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const heartbeat=setInterval(()=>onOutput(`npm install still running (${((now()-started)/1000).toFixed(1)}s, ${seeded?'offline seeded':'cold online'}, attempt ${attempt})\n`),heartbeatMs);
  const timer=setTimeout(()=>{
   timedOut=true;
   // Lifecycle scripts inherit our pipes. Terminate the entire tree so close is bounded.
   try{
    if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:5000});
    else process.kill(-child.pid,'SIGKILL');
   }catch(error){if(error.code!=='ESRCH')child.kill('SIGKILL');}
  },remaining);
  const clear=()=>{clearInterval(heartbeat);clearTimeout(timer);};
  child.once('error',error=>{clear();reject(error);});
  child.once('close',(code,signal)=>{clear();resolve({code,signal,output:attemptOutput,timedOut,seconds:(now()-attemptStarted)/1000});});
  });
 };
 const first=await runAttempt(1);
 const seconds=(now()-started)/1000;
 if(first.timedOut){diagnostic(`Native timing: ${seeded?'offline blob-cached':'cold'} npm install ${seconds.toFixed(1)}s\n`);throw Error(`npm install exceeded ${timeoutMs/1000}s\n${output}`);}
 if(first.code===0){diagnostic(`Native timing: ${seeded?'offline blob-cached':'cold'} npm install ${seconds.toFixed(1)}s\n`);return {output,seconds};}
 const firstExit=first.code??first.signal;
 if(!seeded||!isCandidateEof(first.output,name)){
  diagnostic(`Native timing: ${seeded?'offline blob-cached':'cold'} npm install ${seconds.toFixed(1)}s\n`);
  throw Error(`npm install exited ${firstExit}\n${output}`);
 }

 let currentDigest;
 try{
  currentDigest=await sha256File(tarball,deadline,now);
  if(currentDigest!==initialDigest)throw Error('candidate bytes changed during the first npm install');
  await assertGzip(tarball,deadline,now);
  if(await sha256File(tarball,deadline,now)!==initialDigest)throw Error('candidate bytes changed during gzip validation');
 }catch(error){
  diagnostic(`Candidate EOF retry skipped: ${error.message}\n`);
  diagnostic(`Native timing: offline blob-cached npm install ${((now()-started)/1000).toFixed(1)}s\n`);
  throw Error(`npm install exited ${firstExit}; candidate retry validation failed\n${output}`);
 }

 const remaining=deadline-now();
 if(remaining<=0){
  diagnostic('Candidate EOF retry skipped: original install deadline elapsed\n');
  diagnostic(`Native timing: offline blob-cached npm install ${((now()-started)/1000).toFixed(1)}s\n`);
  throw Error(`npm install exited ${firstExit}; retry deadline elapsed\n${output}`);
 }
 diagnostic(`Seeded candidate archive extraction EOF; ${name} sha256=${initialDigest} is unchanged and gzip-valid. First install took ${first.seconds.toFixed(1)}s. Retrying once with the same offline cache (${remaining.toFixed(0)}ms remain).\n`);
 const retry=await runAttempt(2),totalSeconds=(now()-started)/1000;
 diagnostic(`Native timing: offline blob-cached npm install ${totalSeconds.toFixed(1)}s\n`);
 if(retry.timedOut)throw Error(`npm install exceeded ${timeoutMs/1000}s during one seeded candidate retry (first attempt exited ${firstExit})\n${output}`);
 if(retry.code!==0)throw Error(`npm install retry failed after seeded candidate EOF (first attempt exited ${firstExit}, retry exited ${retry.code??retry.signal})\n${output}`);
 return {output,seconds:totalSeconds};
}
