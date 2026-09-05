#!/usr/bin/env node
import {pathToFileURL} from 'node:url';

const integer=(name,value,min,max)=>{
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<min||parsed>max) throw new Error(`${name} must be an integer from ${min} through ${max}`);
  return parsed;
};

export function parseMigrationArgs(argv,environment=process.env){
  const out={url:environment.BASE_URL||environment.PUBLIC_BASE_URL||'http://127.0.0.1:3000',dryRun:true,batchSize:25,historyLimit:1000,retries:3};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--apply') out.dryRun=false;
    else if(arg==='--url') out.url=argv[++i]??'';
    else if(arg==='--batch-size') out.batchSize=integer('batch size',argv[++i],1,100);
    else if(arg==='--history-limit') out.historyLimit=integer('history limit',argv[++i],0,10_000);
    else if(arg==='--retries') out.retries=integer('retries',argv[++i],0,5);
    else throw new Error(`unknown argument: ${arg}`);
  }
  let url;
  try{url=new URL(out.url);}catch{throw new Error('invalid migration URL');}
  if(url.username||url.password) throw new Error('migration URL must not contain userinfo credentials');
  const loopback=['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback)) throw new Error('refusing cleartext credential transport to a non-loopback host');
  out.url=url.origin;
  return out;
}

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function runMigrationCli(options){
  const fetchFn=options.fetch??fetch;
  const rawWrite=options.write??(line=>console.log(line));
  const write=line=>rawWrite(String(line).split(options.secret).join('[REDACTED]'));
  const endpoint=`${options.url}/api/admin/node-identity`;
  let lastCursor;
  for(;;){
    let response;
    for(let attempt=0;;attempt++){
      try{
        response=await fetchFn(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(options.timeoutMs??30_000),headers:{'content-type':'application/json','x-shared-secret':options.secret},body:JSON.stringify({
          batchSize:options.batchSize,dryRun:options.dryRun,maxHistoricalVersionsPerArtifact:options.historyLimit??1000,
        })});
      }catch{
        response=null;
      }
      if(response&&response.status<500) break;
      if(attempt>=options.retries) {write(`migration request failed after ${attempt+1} attempt(s)`);return {ok:false,reason:'request'};}
      await delay(Math.min(1000,100*2**attempt));
    }
    const body=await response.json().catch(()=>null);
    if(response.status===409&&body?.conflicts?.length){
      write(`migration blocked: ${body.conflicts.map(c=>`${c.artifactId}:${c.reason}`).join(', ')}`);
      return {ok:false,reason:'conflict',report:body};
    }
    if(!response.ok||!body){write(`migration request failed with HTTP ${response.status}`);return {ok:false,reason:'response'};}
    write(`${body.dryRun?'dry-run':'apply'}: processed=${body.processed} changed=${body.changed} cursor=${body.cursor??'-'} done=${body.done}`);
    if(options.dryRun||body.done) return {ok:true,report:body};
    if(!(body.processed>0)||body.cursor===lastCursor){write('migration stopped: successful response made no cursor progress');return {ok:false,reason:'no_progress',report:body};}
    lastCursor=body.cursor;
  }
}

async function main(){
  try{
    const parsed=parseMigrationArgs(process.argv.slice(2));
    const secret=process.env.ADMIN__SECRET;
    if(!secret) throw new Error('ADMIN__SECRET is not set');
    const result=await runMigrationCli({...parsed,secret});
    if(!result.ok) process.exitCode=1;
  }catch(error){console.error(error instanceof Error?error.message:'migration failed');process.exitCode=1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
