/** The shared CI artifact waiter (scripts/lib/ci-artifact-wait.mjs), which the server repository's CI imports. */
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
it('waits only for current-attempt artifacts and fails on packaging failures or deadline',async()=>{
 const {waitForCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 let time=0,calls=0;
 const options={startedAt:'2026-10-06T00:00:00Z',now:()=>time,sleep:async()=>{time+=5000;},jobs:async()=>({jobs:[{name:'CLI npm pack',status:'in_progress'}]}),artifacts:async()=>({artifacts:++calls===1?[{id:1,name:'afbin-npm-release',created_at:'2026-10-05T00:00:00Z'}]:[{id:2,name:'afbin-npm-release',created_at:'2026-10-06T00:01:00Z'}]})};
 expect((await waitForCurrentArtifact(options)).id).toBe(2);
 expect(calls).toBe(2);
 await expect(waitForCurrentArtifact({...options,jobs:async()=>({jobs:[{name:'CLI npm pack',status:'completed',conclusion:'failure'}]})})).rejects.toThrow(/pack failed/);
 time=0;
 await expect(waitForCurrentArtifact({...options,timeout:5000,artifacts:async()=>({artifacts:[]})})).rejects.toThrow(/timed out/);
});

it('preserves GitHub artifact archive checksum verification',async()=>{
 const {verifyArtifactArchive}=await import('../lib/ci-artifact-wait.mjs');
 const digest='sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 expect(()=>verifyArtifactArchive(Buffer.from('abc'),digest)).not.toThrow();
 expect(()=>verifyArtifactArchive(Buffer.from('tampered'),digest)).toThrow(/checksum/);
 expect(()=>verifyArtifactArchive(Buffer.from('abc'),undefined)).toThrow(/checksum/);
});

it('caps the ZIP subprocess buffer at 128 MiB and verifies downloaded bytes',async()=>{
 const {MAX_ARTIFACT_ARCHIVE_BYTES,downloadCurrentArtifactArchive}=await import('../lib/ci-artifact-wait.mjs');
 let observed;
 const bytes=await downloadCurrentArtifactArchive({id:7,size_in_bytes:88463544,digest:'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},{repo:'minusxai/artifactbin',deadline:123,request:async(args,options)=>{observed={args,options};return Buffer.from('abc');}});
 expect(observed.args).toEqual(['api','/repos/minusxai/artifactbin/actions/artifacts/7/zip']);
 expect(observed.options).toEqual({deadline:123,encoding:null,maxBuffer:MAX_ARTIFACT_ARCHIVE_BYTES});
 expect(MAX_ARTIFACT_ARCHIVE_BYTES).toBe(128*1024*1024);expect(bytes.toString()).toBe('abc');
 await expect(downloadCurrentArtifactArchive({id:8,size_in_bytes:MAX_ARTIFACT_ARCHIVE_BYTES+1,digest:'sha256:unused'},{repo:'minusxai/artifactbin',deadline:123,request:async()=>{throw Error('oversized artifact reached ZIP endpoint');}})).rejects.toThrow(/download limit/);
});

it('extracts one named artifact member only after archive verification',async()=>{
 const {downloadAndExtractCurrentArtifactFile,extractSingleArtifactFile}=await import('../lib/ci-artifact-wait.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-seed-extract-'));
 const archive=join(directory,'artifact.zip'),output=join(directory,'npm-dependency-seed.tar');
 writeFileSync(archive,'verified archive bytes');
 const calls=[];
 const execute=(command,args,options)=>{
  calls.push({command,args,options});
  if(args[0]==='-Z1')return Buffer.from('npm-dependency-seed.tar\n');
  return Buffer.from('seed tar bytes');
 };
 try{
  expect(extractSingleArtifactFile(archive,'npm-dependency-seed.tar',output,{execute})).toBe(14);
  expect(readFileSync(output,'utf8')).toBe('seed tar bytes');
  expect(calls.map(call=>call.args.slice(0,2))).toEqual([['-Z1',archive],['-p',archive]]);
  const windowsCalls=[],windowsOutput=join(directory,'windows-seed.tar');
  expect(extractSingleArtifactFile(archive,'npm-dependency-seed.tar',windowsOutput,{platform:'win32',systemRoot:'C:\\Windows',deadline:Date.now()+10000,execute:(command,args,options)=>{
   windowsCalls.push({command,args,options});
   return args[0]==='-tf'?Buffer.from('npm-dependency-seed.tar\n'):Buffer.from('windows seed bytes');
  }})).toBe(18);
  expect(windowsCalls.map(call=>[call.command,call.args.slice(0,2)])).toEqual([
   ['C:\\Windows\\System32\\tar.exe',['-tf',archive]],
   ['C:\\Windows\\System32\\tar.exe',['-xOf',archive]],
  ]);
  expect(windowsCalls[0].options.maxBuffer).toBe(64*1024);
  expect(windowsCalls[1].options.maxBuffer).toBe(128*1024*1024);
  expect(readFileSync(windowsOutput,'utf8')).toBe('windows seed bytes');
  expect(()=>extractSingleArtifactFile(archive,'npm-dependency-seed.tar',output,{execute:(_command,args)=>args[0]==='-Z1'?Buffer.from('npm-dependency-seed.tar\nother\n'):Buffer.from('bad')})).toThrow(/exactly one/);
  const digest='sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const extracted=join(directory,'verified-seed.tar'),callsBefore=calls.length;
  await expect(downloadAndExtractCurrentArtifactFile({id:7,size_in_bytes:3,digest},{repo:'minusxai/artifactbin',deadline:Date.now()+10000,memberName:'npm-dependency-seed.tar',outputPath:extracted,request:async()=>Buffer.from('abc'),execute:(command,args)=>{
   calls.push({command,args});
   if(args[0]==='-Z1')return Buffer.from('npm-dependency-seed.tar\n');
   return Buffer.from('verified seed bytes');
  }})).resolves.toBe(19);
  expect(readFileSync(extracted,'utf8')).toBe('verified seed bytes');
  const callsAfterValid=calls.length;
  await expect(downloadAndExtractCurrentArtifactFile({id:8,size_in_bytes:3,digest},{repo:'minusxai/artifactbin',deadline:Date.now()+10000,memberName:'npm-dependency-seed.tar',outputPath:join(directory,'bad-seed.tar'),request:async()=>Buffer.from('bad'),execute:()=>{throw Error('checksum failure must precede ZIP extraction');}})).rejects.toThrow(/checksum/);
  expect(calls.length).toBe(callsAfterValid);
  expect(callsAfterValid).toBeGreaterThan(callsBefore);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('extracts only the exact versioned candidate and optional provenance from a verified release ZIP',async()=>{
 const {downloadAndExtractCurrentArtifactFiles}=await import('../lib/ci-artifact-wait.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-release-member-')),outputs=[];
 const digest='sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 const artifact={id:41,size_in_bytes:3,digest};
 const members=[{memberName:'afbin-cli-0.4.37.tgz',outputPath:join(directory,'candidate.tgz')},{memberName:'afbin-cli-0.4.37.tgz.sigstore',outputPath:join(directory,'candidate.sigstore'),optional:true}];
 const candidateBytes=gzipSync('candidate tar bytes');
 const execute=(_command,args)=>args[0]==='-Z1'?Buffer.from('afbin-cli-0.4.37.tgz\nafbin-cli-0.4.37.tgz.sigstore\ntransition/install.sh\n'):args[2]==='afbin-cli-0.4.37.tgz'?candidateBytes:Buffer.from('signed bundle');
 const write=(path,bytes)=>outputs.push([path,bytes.toString()]);
 try{
  await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members,request:async()=>Buffer.from('abc'),execute,write})).resolves.toEqual([{memberName:members[0].memberName,size:candidateBytes.length},{memberName:members[1].memberName,size:13}]);
  expect(outputs.map(row=>row[1])).toEqual([candidateBytes.toString(),'signed bundle']);
  let extracted=false;
  await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members,request:async()=>Buffer.from('tampered'),execute:()=>{extracted=true;return Buffer.alloc(0);},write})).rejects.toThrow(/checksum/);
  expect(extracted).toBe(false);
  await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members,request:async()=>Buffer.from('abc'),execute:(_command,args)=>args[0]==='-Z1'?Buffer.from('afbin-cli-0.4.37.tgz\nafbin-cli-0.4.37.tgz.sigstore\n'):args[2]==='afbin-cli-0.4.37.tgz'?candidateBytes.subarray(0,candidateBytes.length-4):Buffer.from('signed bundle'),write})).rejects.toThrow(/truncated or invalid/);
  for(const listing of ['afbin-cli-0.4.36.tgz\n','afbin-cli-0.4.37.tgz\nafbin-cli-0.4.37.tgz\n','../afbin-cli-0.4.37.tgz\n']){
   await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members,request:async()=>Buffer.from('abc'),execute:(_command,args)=>args[0]==='-Z1'?Buffer.from(listing):Buffer.alloc(0),write})).rejects.toThrow();
  }
  const optional=[{memberName:'afbin-cli-0.4.37.tgz',outputPath:members[0].outputPath},{memberName:'afbin-cli-0.4.37.tgz.sigstore',outputPath:members[1].outputPath,optional:true}];
  await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members:optional,request:async()=>Buffer.from('abc'),execute:(_command,args)=>args[0]==='-Z1'?Buffer.from('afbin-cli-0.4.37.tgz\n'):candidateBytes,write})).resolves.toHaveLength(1);
  await expect(downloadAndExtractCurrentArtifactFiles(artifact,{repo:'minusxai/artifactbin',deadline:Date.now()+10000,members:[{memberName:'bundle.sigstore',outputPath:members[1].outputPath,optional:true,maxBytes:8}],request:async()=>Buffer.from('abc'),execute:(_command,args,options)=>{if(args[0]!=='-Z1')expect(options.maxBuffer).toBe(8);return args[0]==='-Z1'?Buffer.from('bundle.sigstore\n'):Buffer.alloc(9);},write})).rejects.toThrow(/size limit/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('binds optional candidate sidecars to the exact package bytes, source, and run',async()=>{
 const {validateCandidateProvenance}=await import('../lib/ci-artifact-wait.mjs');
 const bytes=Buffer.from('exact candidate'),version='0.4.37',run='12345',sha='a'.repeat(40),digest=createHash('sha512').update(bytes).digest('hex');
 const bundle={dsseEnvelope:{payload:Buffer.from(JSON.stringify({_type:'https://in-toto.io/Statement/v1',subject:[{name:`pkg:npm/%40afbin/cli@${version}`,digest:{sha512:digest}}],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{externalParameters:{workflow:{repository:'https://github.com/minusxai/artifactbin',path:'.github/workflows/ci.yml',ref:'refs/pull/12/merge'}},resolvedDependencies:[{uri:'git+https://github.com/minusxai/artifactbin@refs/pull/12/merge',digest:{gitCommit:sha}}]},runDetails:{metadata:{invocationId:`https://github.com/minusxai/artifactbin/actions/runs/${run}/attempts/1`}}}})).toString('base64'),signatures:[{sig:'opaque signed envelope'}]},verificationMaterial:{}};
 expect(()=>validateCandidateProvenance({bundle,metadata:{run_id:run,source_sha:sha},version,bytes,run,sha})).not.toThrow();
 expect(()=>validateCandidateProvenance({bundle,metadata:{run_id:'999',source_sha:sha},version,bytes,run,sha})).toThrow(/build metadata/);
 expect(()=>validateCandidateProvenance({bundle,metadata:{run_id:run,source_sha:sha},version,bytes:Buffer.from('changed'),run,sha})).toThrow(/subject/);
});

it('downloads a specifically named artifact only from the current attempt and verifies its archive',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-named-artifact-'));
 const calls=join(directory,'calls'),gh=join(directory,'gh'),output=join(directory,'seed.zip'),badOutput=join(directory,'bad-seed.zip'),failure=join(directory,'failed.json');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const path=process.argv[3];fs.appendFileSync(${JSON.stringify(calls)},path+'\\n');if(path.endsWith('/zip'))process.stdout.write(process.env.TAMPER?'bad':'abc');else if(path.endsWith('/attempts/2'))console.log(JSON.stringify({run_started_at:'2026-10-06T00:00:00Z'}));else if(path.includes('/jobs?'))console.log(JSON.stringify({jobs:[{name:'CLI npm pack',status:'in_progress'}]}));else console.log(JSON.stringify({artifacts:[{id:123,name:'afbin-npm-dependency-seed-Windows-X64',created_at:'2026-10-06T00:01:00Z',size_in_bytes:process.env.TOO_LARGE?134217729:88463544,digest:'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}]}));
`);chmodSync(gh,0o755);
 try{
  const {MAX_ARTIFACT_ARCHIVE_BYTES}=await import('../lib/ci-artifact-wait.mjs');
  expect(MAX_ARTIFACT_ARCHIVE_BYTES).toBe(128*1024*1024);
  const command=fileURLToPath(new URL('../lib/ci-artifact-wait.mjs',import.meta.url)),args=['minusxai/artifactbin','100','2'];
  const result=spawnSync(process.execPath,[command,...args,output,failure,'afbin-npm-dependency-seed-Windows-X64'],{encoding:'utf8',env:{...process.env,PATH:directory+':'+process.env.PATH}});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('afbin-npm-dependency-seed-Windows-X64');
  expect(readFileSync(output,'utf8')).toBe('abc');
  const requested=readFileSync(calls,'utf8');expect(requested).toContain('/runs/100/attempts/2');expect(requested).toContain('/artifacts/123/zip');
  const tampered=spawnSync(process.execPath,[command,...args,badOutput,failure,'afbin-npm-dependency-seed-Windows-X64'],{encoding:'utf8',env:{...process.env,TAMPER:'1',PATH:directory+':'+process.env.PATH}});
  expect(tampered.status).toBe(1);expect(tampered.stderr).toContain('checksum');expect(existsSync(badOutput)).toBe(false);
  writeFileSync(calls,'');
  const oversized=spawnSync(process.execPath,[command,...args,join(directory,'too-large.zip'),failure,'afbin-npm-dependency-seed-Windows-X64'],{encoding:'utf8',env:{...process.env,TOO_LARGE:'1',PATH:directory+':'+process.env.PATH}});
  expect(oversized.status).toBe(1);expect(oversized.stderr).toContain('download limit');expect(readFileSync(calls,'utf8')).not.toContain('/zip');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('wait-only CLI checks exact attempt and accepts readiness without downloading a duplicate zip',()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-wait-only-'));
 const calls=join(directory,'calls');
 const gh=join(directory,'gh');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const path=process.argv[3];fs.appendFileSync(${JSON.stringify(calls)},path+'\\n');console.log(JSON.stringify(path.endsWith('/attempts/2')?{run_started_at:'2026-10-06T00:00:00Z'}:path.includes('/jobs?')?{jobs:[{name:'CLI npm pack',status:'in_progress'}]}:{artifacts:[{id:123,name:'afbin-npm-release',created_at:'2026-10-06T00:01:00Z'}]}));
`);chmodSync(gh,0o755);
 try{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../lib/ci-artifact-wait.mjs',import.meta.url)),'--wait-only','minusxai/artifactbin','100','2'],{encoding:'utf8',env:{...process.env,PATH:directory+':'+process.env.PATH}});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Ready');
  const requested=readFileSync(calls,'utf8');expect(requested).toContain('/runs/100/attempts/2');expect(requested).not.toContain('/zip');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('reuses current-attempt waiting for prepared CLI packages without accepting other producers or stale artifacts',async()=>{
 const {waitForCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 let time=0,calls=0;
 const current={id:3,name:'prepared-cli',created_at:'2026-10-06T00:01:00Z'};
 const options={jobName:'package',artifactName:'prepared-cli',startedAt:'2026-10-06T00:00:00Z',now:()=>time,sleep:async()=>{time+=5000;},jobs:async()=>({jobs:[{name:'package',status:'in_progress'},{name:'CLI npm pack',status:'completed',conclusion:'failure'}]}),artifacts:async()=>({artifacts:++calls===1?[{...current,id:1,created_at:'2026-10-05T00:01:00Z'},{...current,id:2,expired:true},{...current,id:4,name:'afbin-npm-release'}]:[current]})};
 expect((await waitForCurrentArtifact(options)).id).toBe(3);expect(calls).toBe(2);
 await expect(waitForCurrentArtifact({...options,jobs:async()=>({jobs:[{name:'package',status:'completed',conclusion:'failure'}]})})).rejects.toThrow('package failed');
 await expect(waitForCurrentArtifact({...options,artifacts:async()=>({artifacts:[current,{...current,id:5}]})})).rejects.toThrow(/Multiple current-attempt/);
 time=0;await expect(waitForCurrentArtifact({...options,timeout:5000,artifacts:async()=>({artifacts:[{...current,expired:true}]})})).rejects.toThrow(/timed out/);
});

it('recovers a real gh transport timeout within the original artifact deadline',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-gh-transport-')),calls=join(directory,'calls'),gh=join(directory,'gh');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const file=${JSON.stringify(calls)};const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(count+1));if(!count)setInterval(()=>{},1000);else console.log(JSON.stringify({ready:true}));
`);chmodSync(gh,0o755);
 try{
  const result=await requestCurrentArtifact(['api','fixture'],{command:gh,deadline:Date.now()+5000,requestTimeout:1000,retryDelay:1});
  expect(JSON.parse(result)).toEqual({ready:true});expect(readFileSync(calls,'utf8')).toBe('2');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it('does not retry real gh authorization failures',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-gh-permanent-')),calls=join(directory,'calls'),gh=join(directory,'gh');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},'call\\n');console.error('HTTP 403 forbidden');process.exit(1);
`);chmodSync(gh,0o755);
 try{
  await expect(requestCurrentArtifact(['api','fixture'],{command:gh,deadline:Date.now()+2000,retryDelay:1})).rejects.toThrow(/403/);
  expect(readFileSync(calls,'utf8')).toBe('call\n');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it('bounds transport retries and each request by the original deadline',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 let time=0,calls=0;const timeouts=[];
 const options={deadline:200,now:()=>time,requestTimeout:30,retryDelay:5,request:(_command,_args,options)=>{calls++;timeouts.push(options.timeout);time+=options.timeout;throw Object.assign(Error('transport timed out'),{code:'ETIMEDOUT'});},sleep:async delay=>{time+=delay;}};
 await expect(requestCurrentArtifact(['api','fixture'],options)).rejects.toThrow(/transport timed out/);
 expect(calls).toBe(3);expect(time).toBe(100);expect(timeouts).toEqual([30,30,30]);
 calls=0;time=198;await expect(requestCurrentArtifact(['api','fixture'],options)).rejects.toThrow(/artifact timed out/);expect(calls).toBe(1);expect(time).toBe(200);expect(timeouts.at(-1)).toBe(2);
});
it('does not accept a candidate after requests consume the artifact deadline',async()=>{
 const {waitForCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');let time=0;
 await expect(waitForCurrentArtifact({startedAt:'2026-10-06T00:00:00Z',timeout:100,now:()=>time,jobs:async()=>{time=100;return{jobs:[]};},artifacts:async()=>({artifacts:[{name:'afbin-npm-release',created_at:'2026-10-06T00:01:00Z'}]})})).rejects.toThrow(/artifact timed out/);
});

it('retries a 404 or 5xx on the zip of an artifact the listing already reported, within a bounded window',async()=>{
 const {downloadCurrentArtifactArchive}=await import('../lib/ci-artifact-wait.mjs');
 const artifact={id:7,digest:'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
 let time=0,calls=0;const delays=[];
 const notFound=()=>Object.assign(Error('gh failed'),{status:1,stderr:Buffer.from('gh: Not Found (HTTP 404)')});
 const options={repo:'o/r',deadline:1e9,now:()=>time,sleep:async delay=>{delays.push(delay);time+=delay;},request:async()=>{if(++calls<=2)throw notFound();return Buffer.from('abc');}};
 expect((await downloadCurrentArtifactArchive(artifact,options)).toString()).toBe('abc');
 expect(calls).toBe(3);expect(delays).toEqual([2000,4000]);
 calls=0;time=0;delays.length=0;
 await expect(downloadCurrentArtifactArchive(artifact,{...options,request:async()=>{calls++;throw Object.assign(new Error('gh failed'),{status:1,stderr:'gh: Bad Gateway (HTTP 502)'});}})).rejects.toThrow('gh failed');
 expect(time).toBeLessThanOrEqual(60000);expect(calls).toBeGreaterThan(3);
 calls=0;await expect(downloadCurrentArtifactArchive(artifact,{...options,request:async()=>{calls++;throw Object.assign(new Error('gh failed'),{status:1,stderr:'HTTP 403 forbidden'});}})).rejects.toThrow('gh failed');expect(calls).toBe(1);
 calls=0;time=0;await expect(downloadCurrentArtifactArchive(artifact,{...options,deadline:3000,request:async()=>{calls++;throw notFound();}})).rejects.toThrow('gh failed');expect(time).toBeLessThan(3000);
});
it('explains on a rerun attempt that only a full rerun recovers a packed candidate',()=>{
 const source=readFileSync(new URL('../lib/ci-artifact-wait.mjs',import.meta.url),'utf8');
 expect(source).toContain('GITHUB_RUN_ATTEMPT');expect(source).toContain('gh run rerun <run-id>');
});

it('leaves malformed API responses and non-transport process failures authoritative',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');let calls=0;
 const options={deadline:Date.now()+1000,request:()=>{calls++;return '{not-json';}};
 await expect((async()=>JSON.parse(await requestCurrentArtifact(['api','fixture'],options)))()).rejects.toThrow();expect(calls).toBe(1);
 calls=0;await expect(requestCurrentArtifact(['api','fixture'],{...options,request:()=>{calls++;throw Object.assign(Error('output exceeded'),{code:'ENOBUFS'});}})).rejects.toThrow('output exceeded');expect(calls).toBe(1);
});

it('recovers a real gh HTTP 502 while waiting for the same-attempt artifact',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-gh-http-transient-')),calls=join(directory,'calls'),gh=join(directory,'gh');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const file=${JSON.stringify(calls)};const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(count+1));if(!count){console.error('gh: Server Error (HTTP 502)');process.exit(1);}console.log(JSON.stringify({ready:true}));
`);chmodSync(gh,0o755);
 try{
  expect(JSON.parse(await requestCurrentArtifact(['api','fixture'],{command:gh,deadline:Date.now()+5000,retryDelay:1}))).toEqual({ready:true});
  expect(readFileSync(calls,'utf8')).toBe('2');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('bounds transient gh HTTP failures by the original deadline and three requests',async()=>{
 const {requestCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');let time=0,calls=0;
 const options={deadline:200,now:()=>time,retryDelay:5,requestTimeout:30,request:(_command,_args,options)=>{calls++;time+=options.timeout;throw Object.assign(Error('gh HTTP 503'),{status:1,stderr:Buffer.from('gh: Service Unavailable (HTTP 503)')});},sleep:async delay=>{time+=delay;}};
 await expect(requestCurrentArtifact(['api','fixture'],options)).rejects.toThrow('gh HTTP 503');expect(calls).toBe(3);expect(time).toBe(100);
 calls=0;time=198;await expect(requestCurrentArtifact(['api','fixture'],options)).rejects.toThrow(/artifact timed out/);expect(calls).toBe(1);expect(time).toBe(200);
});
