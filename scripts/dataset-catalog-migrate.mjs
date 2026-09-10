#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {mkdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const integer=(name,value,min,max)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${name} must be an integer from ${min} through ${max}`);return n;};
export function parseMigrationArgs(argv,environment=process.env){const out={url:environment.BASE_URL||environment.PUBLIC_BASE_URL||'http://127.0.0.1:3000',dryRun:true,batchSize:25,historyLimit:1000,retries:3};for(let i=0;i<argv.length;i++){const arg=argv[i];if(arg==='--apply')out.dryRun=false;else if(arg==='--backup-dir')out.backupDir=argv[++i]??'';else if(arg==='--url')out.url=argv[++i]??'';else if(arg==='--batch-size')out.batchSize=integer('batch size',argv[++i],1,100);else if(arg==='--history-limit')out.historyLimit=integer('history limit',argv[++i],0,10000);else if(arg==='--retries')out.retries=integer('retries',argv[++i],0,5);else throw new Error(`unknown argument: ${arg}`);}let url;try{url=new URL(out.url);}catch{throw new Error('invalid migration URL');}if(url.username||url.password)throw new Error('migration URL must not contain userinfo credentials');const loopback=['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('refusing cleartext credential transport to a non-loopback host');out.url=url.origin;return out;}
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
/** Inventory and persist every page before the first write. The server compares each reviewed snapshot. */
export async function runMigrationCli(options){
 const fetchFn=options.fetch??fetch;
 const raw=options.write??((line)=>console.log(line));
 const write=(line)=>raw(String(line).split(options.secret).join('[REDACTED]'));
 const endpoint=`${options.url}/api/admin/dataset-catalog`;
 const backupDir=resolve(options.backupDir??`artifactbin-migration-${randomUUID()}`);
 let page=0;
 const saveReport=options.saveReport??(async(report)=>{
  await mkdir(backupDir,{recursive:true,mode:0o700});
  const file=await open(join(backupDir,`${String(++page).padStart(5,'0')}.json`),'wx',0o600);
  try{await file.writeFile(JSON.stringify({origin:options.url,...report},null,2)+'\n');await file.sync();}finally{await file.close();}
  const directory=await open(backupDir,'r');try{await directory.sync();}finally{await directory.close();}
 });
 const request=async(input)=>{
  let response;
  for(let attempt=0;;attempt++){
   try{response=await fetchFn(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(options.timeoutMs??30000),headers:{'content-type':'application/json','x-shared-secret':options.secret},body:JSON.stringify({batchSize:options.batchSize,maxHistoricalVersionsPerArtifact:options.historyLimit??1000,...input})});}catch{response=null;}
   if(response&&response.status<500)break;
   if(attempt>=options.retries){write(`migration request failed after ${attempt+1} attempt(s)`);return {ok:false,reason:'request'};}
   await delay(Math.min(1000,100*2**attempt));
  }
  const body=await response.json().catch(()=>null);
  if(response.status===409&&body?.conflicts?.length)return {ok:false,reason:'conflict',report:body};
  if(!response.ok||!body){write(`migration request failed with HTTP ${response.status}`);return {ok:false,reason:'response'};}
  return {ok:true,report:body};
 };
 const pages=[];let after;const cursors=new Set();let blocked=false;
 for(;;){
  const result=await request({dryRun:true,...(after?{after}:{})});
  if(!result.report)return result;
  await saveReport(result.report);pages.push(result.report);
  write(`dry-run: processed=${result.report.processed} changed=${result.report.changed} done=${result.report.done}`);
  if(!result.ok){blocked=true;write(`migration blocked: ${result.report.conflicts.map(c=>`${c.artifactId}:${c.reason}`).join(', ')}`);}
  after=result.report.nextCursor;
  if(!after)break;
  if(cursors.has(after))return {ok:false,reason:'no_progress'};
  cursors.add(after);
 }
 write(`migration preview and backups: ${backupDir}`);
 if(blocked)return {ok:false,reason:'conflict',report:pages.at(-1)};
 if(options.dryRun)return {ok:true,report:pages.at(-1)};
 for(const preview of pages){
  const expected=Object.fromEntries((preview.plans??[]).map(plan=>[plan.artifactId,plan.fingerprint]));
  if(!Object.keys(expected).length)continue;
  const result=await request({dryRun:false,expected});
  if(!result.ok){write('migration stopped; keep backups and preview again before retrying');return result;}
  write(`apply: processed=${result.report.processed} changed=${result.report.changed} done=${result.report.done}`);
 }
 const audit=await request({dryRun:true});
 if(!audit.ok)return audit;
 await saveReport(audit.report);
 if(!audit.report.done || audit.report.changed || audit.report.conflicts?.length){
  write('migration incomplete: the final audit found remaining work; keep backups and review a fresh preview');
  return {ok:false,reason:'remaining',report:audit.report};
 }
 write('migration complete: final audit found no remaining reference or catalog changes');
 return {ok:true,report:audit.report};
}
async function main(){try{const parsed=parseMigrationArgs(process.argv.slice(2));const secret=process.env.ADMIN__SECRET;if(!secret)throw new Error('ADMIN__SECRET is not set');const result=await runMigrationCli({...parsed,secret});if(!result.ok)process.exitCode=1;}catch(error){console.error(error instanceof Error?error.message:'migration failed');process.exitCode=1;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
