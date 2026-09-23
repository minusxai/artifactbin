/** CI-only: a real standalone command exits while its detached updater awaits HTTP. */
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
const run=promisify(execFile);
export async function checkBackgroundUpdate(binary){
 const home=await mkdtemp(join(tmpdir(),'afbin-detached-')),state=join(home,'.artifactbin');
 await mkdir(state);await writeFile(join(state,'settings.json'),JSON.stringify({harnesses:[]}));
 const version=JSON.parse((await run(binary,['--version','--json'])).stdout).version;
 let held,requests=0;
 const server=createServer((req,res)=>{
  requests++;
  if(req.url!=='/chat/release.json'){res.writeHead(500);res.end();return;}
  held=res;
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env,ARTIFACTBIN_HOME:state,ARTIFACTBIN_URL:`http://127.0.0.1:${server.address().port}`,CLI__AUTO_UPDATE:'1',CLI__VERSION_PIN:''};
 const until=async(check)=>{const end=Date.now()+20000;while(!check()){assert.ok(Date.now()<end,'background worker did not finish');await sleep(25);}};
 try {
  const command=await run(binary,['help'],{env,cwd:home,timeout:10000,maxBuffer:1048576});
  assert.equal(command.stderr,'');assert.match(command.stdout,/afbin/);
  await until(()=>!!held);
  // If discovery were awaited or stdio inherited, the execFile above could not finish.
  const second=await run(binary,['help'],{env,cwd:home,timeout:10000,maxBuffer:1048576});
  assert.equal(second.stderr,'');assert.equal(requests,1,'a live worker suppresses duplicate discovery');
  const readCheck=()=>{
   let db;
   try{db=new DatabaseSync(join(state,'state.sqlite'),{readOnly:true});const row=db.prepare("select value from records where kind='background-update'").get();return row&&JSON.parse(row.value);}
   finally{db?.close();}
  };
  const pending=readCheck();
  // Success and retry both use one hour. Observe a new completion timestamp,
  // not merely the retry deadline written before the worker starts its request.
  await sleep(5);
  held.end(JSON.stringify({version,protocol:2}));
  await until(()=>{
   try{const value=readCheck();return value&&value.attemptedAt>pending.attemptedAt&&value.nextAt-value.attemptedAt===60*60*1000;}
   catch{return false;}
  });
  await run(binary,['help'],{env,cwd:home,timeout:10000,maxBuffer:1048576});
  assert.equal(requests,1,'completed checks are throttled across invocations');
  console.log('Standalone detached updater: command exit, held HTTP, single worker and persisted throttle passed.');
 }finally{held?.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}
}
