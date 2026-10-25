/** Current-attempt source packages: bounded transport, exact identity and native payload bytes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {requestCurrentArtifact,downloadAndExtractCurrentArtifactFile} from './ci-artifact-wait.mjs';
const LIMIT=128*1024*1024,FILE_LIMIT=64*1024*1024,RECEIPT='source-receipt.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeName=name=>typeof name==='string'&&name.length<=100&&/^[A-Za-z0-9._+/-]+$/.test(name)&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
function linkTarget(name,target){
 assert.ok(typeof target==='string'&&target.length<=100&&!target.startsWith('/')&&!target.includes('\\'),'Unsafe source link');
 const normalized=posix.normalize(posix.join(posix.dirname(name),target));
 assert.ok(safeName(normalized),'Escaping source link');return normalized;
}
function validateIdentity(identity){
 for(const key of ['component','profile'])assert.match(identity[key]??'',/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
 assert.match(identity.input_sha256??'',/^[a-f0-9]{64}$/);assert.match(identity.source_sha??'',/^[a-f0-9]{40}$/);
 assert.match(identity.repository??'',/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
 for(const key of ['run_id','run_attempt'])assert.match(identity[key]??'',/^[1-9][0-9]*$/);
 assert.match(identity.platform??'',/^linux\/(?:amd64|arm64)$/);
 assert.match(identity.base??'',/^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/);
 assert.ok(Number.isFinite(Date.parse(identity.workflow_started_at)),'Invalid workflow start');
}
/** Core defaults remain 300s/480s. Explicit consumers bind their existing phase clock and budgets. */
export function sourceDeadline(startedAt,now=Date.now(),budget){
 const started=Date.parse(startedAt);assert.ok(Number.isFinite(started),'Invalid workflow start');
 assert.ok(Number.isSafeInteger(now)&&now>=started,'Invalid source operation clock');
 if(budget===undefined)return Math.min(now+300_000,started+480_000);
 const {operation_started_at:operationStart,operation_ms:operationMs,chain_ms:chainMs}=budget;
 assert.ok(Number.isSafeInteger(operationStart)&&operationStart>=started&&operationStart<=now,'Invalid original source operation start');
 for(const value of [operationMs,chainMs])assert.ok(Number.isSafeInteger(value)&&value>0&&value<=600_000,'Invalid source budget (maximum supported contract 600 seconds)');
 return Math.min(operationStart+operationMs,started+chainMs);
}
/** Hash exactly the caller's tracked source/recipe inputs, including modes and relative paths. */
export function sourceInputHash(root,paths){
 const hash=createHash('sha256');
 function visit(name){
  assert.ok(safeName(name),'Unsafe source input');const file=join(root,name),stat=lstatSync(file);
  if(stat.isDirectory()){for(const child of readdirSync(file).sort())visit(name+'/'+child);return;}
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Source inputs must be regular files');
  hash.update(name+'\0'+(stat.mode&0o777).toString(8)+'\0');hash.update(readFileSync(file));hash.update('\0');
 }
 for(const path of [...paths].sort())visit(path);return hash.digest('hex');
}
function tarEntry(name,bytes,mode,type='0',target=''){
 assert.ok(safeName(name),'Unsafe source archive path');assert.ok(bytes.length<=FILE_LIMIT,'Source payload too large');
 const header=Buffer.alloc(512);
 const text=(offset,length,value)=>{assert.ok(Buffer.byteLength(value)<length);header.write(value,offset,length,'ascii');};
 text(0,101,name);text(100,8,mode.toString(8).padStart(7,'0'));text(108,8,'0000000');text(116,8,'0000000');
 text(124,12,bytes.length.toString(8).padStart(11,'0'));text(136,12,'00000000000');header.fill(32,148,156);
 header.write(type,156);if(target)text(157,101,target);header.write('ustar\0',257);header.write('00',263);
 const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
 return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512)]);
}
export function buildSourceArchive(identity,entries){
 validateIdentity(identity);assert.ok(entries.length>0&&entries.length<=2000,'Empty or excessive source payload');
 const files=Object.create(null),blocks=[];
 for(const entry of [...entries].sort((a,b)=>a.name.localeCompare(b.name))){
  assert.ok(safeName(entry.name)&&entry.name!==RECEIPT,'Unsafe source archive path');
  assert.ok(!Object.hasOwn(files,entry.name),'Duplicate source archive path');
  const mode=entry.mode&0o777;assert.ok(mode===entry.mode,'Unsafe source mode');
  if(entry.target!==undefined){
   linkTarget(entry.name,entry.target);files[entry.name]={type:'symlink',mode,target:entry.target};
   blocks.push(tarEntry(entry.name,Buffer.alloc(0),mode,'2',entry.target));
  }else{
   assert.ok(Buffer.isBuffer(entry.bytes),'Source bytes required');files[entry.name]={type:'file',mode,size:entry.bytes.length,sha256:sha(entry.bytes)};
   blocks.push(tarEntry(entry.name,entry.bytes,mode));
  }
 }
 for(const [name,file] of Object.entries(files))if(file.type==='symlink'){
  let current=name;const seen=new Set();
  while(files[current]?.type==='symlink'){assert.ok(!seen.has(current),'Cyclic source link');seen.add(current);current=linkTarget(current,files[current].target);}
  assert.equal(files[current]?.type,'file','Missing source link payload');
 }
 for(const name of Object.keys(files))for(let parent=posix.dirname(name);parent!=='.';parent=posix.dirname(parent))assert.ok(!Object.hasOwn(files,parent),'Conflicting source ancestor path');
 const receipt=Buffer.from(JSON.stringify({schema:1,identity,files})+'\n');
 const archive=Buffer.concat([tarEntry(RECEIPT,receipt,0o644),...blocks,Buffer.alloc(1024)]);
 assert.ok(archive.length<=LIMIT,'Source archive too large');return archive;
}
export function readSourceArchive(bytes,expected){
 validateIdentity(expected);assert.ok(Buffer.isBuffer(bytes)&&bytes.length<=LIMIT&&bytes.length%512===0,'Invalid source archive');
 const entries=new Map();let offset=0,terminated=false;
 while(offset<bytes.length){
  const header=bytes.subarray(offset,offset+512);offset+=512;
  if(header.every(byte=>byte===0)){assert.ok(bytes.subarray(offset).every(byte=>byte===0),'Trailing source archive data');terminated=true;break;}
  const text=(start,length)=>header.subarray(start,start+length).toString('ascii').replace(/\0.*$/s,'');
  const number=(start,length)=>{const value=text(start,length).trim();assert.match(value,/^[0-7]+$/,'Invalid source numeric field');return parseInt(value,8);};
  const original=number(148,8),copy=Buffer.from(header);copy.fill(32,148,156);
  assert.equal(copy.reduce((sum,byte)=>sum+byte,0),original,'Source header checksum');
  const name=text(0,100),type=text(156,1)||'0',size=number(124,12),mode=number(100,8);
  assert.ok(safeName(name)&&!text(345,155),'Unsafe source archive path');assert.ok(!entries.has(name),'Duplicate source archive path');
  assert.ok(['0','2'].includes(type)&&mode<=0o777&&size<=FILE_LIMIT,'Unsupported source archive member');
  assert.ok(offset+size<=bytes.length,'Truncated source payload');
  const entry=type==='2'?{name,mode,target:text(157,100)}:{name,mode,bytes:Buffer.from(bytes.subarray(offset,offset+size))};
  if(type==='2'){assert.equal(size,0);linkTarget(name,entry.target);}
  entries.set(name,entry);offset+=Math.ceil(size/512)*512;
 }
 assert.ok(terminated,'Missing source archive terminator');
 const receiptEntry=entries.get(RECEIPT);assert.ok(receiptEntry?.bytes&&receiptEntry.bytes.length<=1024*1024,'Missing source receipt');
 const receipt=JSON.parse(receiptEntry.bytes.toString());assert.equal(receipt.schema,1);
 assert.deepEqual(receipt.identity,expected,'Source artifact identity mismatch');entries.delete(RECEIPT);
 assert.deepEqual([...entries.keys()].sort(),Object.keys(receipt.files).sort(),'Source receipt inventory mismatch');
 for(const [name,entry] of entries){
  const record=receipt.files[name];assert.equal(entry.mode,record.mode,'Source mode mismatch');
  if(entry.target!==undefined)assert.deepEqual(record,{type:'symlink',mode:entry.mode,target:entry.target},'Source link mismatch');
  else{assert.equal(record.type,'file');assert.equal(entry.bytes.length,record.size,'Source payload size mismatch');assert.equal(sha(entry.bytes),record.sha256,'Source payload hash mismatch');}
 }
 // Reapply link closure validation after untrusted decoding.
 buildSourceArchive(expected,[...entries.values()]);
 return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
/** Bounded pagination shares the caller's one deadline; a repeated API identity is not new evidence. */
async function currentPages(path,key,{request,deadline}){
 const entries=[],seen=new Set();
 for(let page=1;page<=10;page++){
  const data=JSON.parse(await request(['api',`${path}&page=${page}`],{deadline}));
  const items=data[key];assert.ok(Array.isArray(items)&&items.length<=100,'Invalid current-attempt page');
  if(data.total_count!==undefined)assert.ok(Number.isSafeInteger(data.total_count)&&data.total_count>=0&&data.total_count<=1000,'Current-attempt pagination exceeds bound');
  for(const item of items){
   assert.ok(Number.isSafeInteger(item.id)&&item.id>0,'Invalid current-attempt item identity');
   assert.ok(!seen.has(item.id),'Duplicate current-attempt item identity');seen.add(item.id);entries.push(item);
  }
  if(items.length<100&&(data.total_count===undefined||entries.length>=data.total_count))return entries;
 }
 throw Error('Current-attempt pagination exceeds bound');
}
/** Outer GitHub SHA256 + attempt timestamps, inner source identity and per-file hashes. */
export async function collectCurrentSourceArtifacts({repository,run,attempt,identities,artifactName,jobName,deadline:providedDeadline,budget,request=requestCurrentArtifact,now=Date.now,pause=sleep}){
 const components=Object.keys(identities);assert.ok(components.length>0);
 const startedAt=identities[components[0]].workflow_started_at,policyDeadline=sourceDeadline(startedAt,now(),budget),deadline=providedDeadline??policyDeadline;
 for(const component of components){const identity=identities[component];validateIdentity(identity);assert.equal(identity.component,component);assert.equal(identity.repository,repository);assert.equal(identity.run_id,run);assert.equal(identity.run_attempt,attempt);assert.equal(identity.workflow_started_at,startedAt,'Source operation workflow start mismatch');}
 assert.ok(Number.isSafeInteger(deadline)&&deadline>0&&deadline<=policyDeadline,'Source deadline cannot extend the original operation');
 const result=new Map();
 while(result.size<components.length){
  if(now()>=deadline)throw Error('Current-attempt source artifacts timed out');
  const [artifacts,jobs]=await Promise.all([
   currentPages(`/repos/${repository}/actions/runs/${run}/artifacts?per_page=100`,'artifacts',{request,deadline}),
   currentPages(`/repos/${repository}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,'jobs',{request,deadline}),
  ]);
  for(const component of components){
   const matches=jobs.filter(job=>job.name===jobName(component));assert.ok(matches.length<=1,'Duplicate source producer identity');
   const job=matches[0];
   if(job?.status==='completed'&&job.conclusion!=='success')throw Error(`Required source producer failed: ${component}`);
  }
  await Promise.all(components.filter(component=>!result.has(component)).map(async component=>{
   const producer=jobs.find(job=>job.name===jobName(component));
   if(producer?.status!=='completed'||producer.conclusion!=='success')return;
   const available=artifacts.filter(artifact=>artifact.name===artifactName(component)&&!artifact.expired&&Date.parse(artifact.created_at)>=Date.parse(startedAt));
   assert.ok(available.length<=1,'Multiple current-attempt source artifacts');if(!available.length)return;
   const directory=mkdtempSync(join(tmpdir(),'source-artifact-'));
   try{
    const file=join(directory,'component.tar');
    await downloadAndExtractCurrentArtifactFile(available[0],{repo:repository,deadline,request,memberName:component+'.tar',outputPath:file,now});
    result.set(component,readSourceArchive(readFileSync(file),identities[component]));
   }finally{rmSync(directory,{recursive:true,force:true});}
  }));
  if(now()>=deadline)throw Error('Current-attempt source artifacts timed out');
  if(result.size<components.length)await pause(Math.min(5000,deadline-now()));
 }
 return result;
}
