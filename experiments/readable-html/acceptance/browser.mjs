import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { gzipSync } from 'node:zlib';
import { decode, save } from '../source/codec.mjs';
import { encodeRuntime } from '../source/packaging.mjs';
import { createRepository } from '../workflow/workflow.ts';
import { validateReceipt } from './receipt.mjs';
const built = await build({entryPoints:['experiments/readable-html/acceptance/runtime.ts'],bundle:true,write:false,format:'iife',platform:'browser',minify:true});
const runtime = encodeRuntime(built.outputFiles[0].text);
const pack = (source,state)=>save(source,state).replace('<script data-pagegi-runtime="2"></script>',()=>'<script data-pagegi-runtime="2">'+runtime+'</script>');
const fixture = '<!doctype html><html><head><meta charset="utf-8"><script data-pagegi-runtime="2">'+runtime+'</script><script id="pagegi-state" type="application/json">{"format":2,"app":{"count":0},"comments":[]}</script></head><body><h1 data-pagegi-id="heading">Original title</h1><af-markdown data-pagegi-id="notes"><script type="application/json" data-af-source>"## Offline notes"</script></af-markdown><script type="application/pagegi">document.querySelector("h1").dataset.active="yes";</script></body></html>';
const dir = await mkdtemp(join(tmpdir(),'phase1-acceptance-'));
let server;
const receipts=[];
try {
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 const ca = await readFile(join(dir,'cert.pem'));
 const repo=createRepository({decode:async html=>{const d=await decode(html,{runtime});return {source:d.source,revision:d.revision,initialState:d.state};}});
 server=https.createServer({key:await readFile(join(dir,'key.pem')),cert:ca},async(req,res)=>{
  const auth=req.headers.cookie==='session=synthetic-owner';
  if(!auth){res.writeHead(401);res.end('unauthorized');return;}
  try {
   const id=new URL(req.url,'https://localhost').searchParams.get('id');
   if(req.method==='PUT') {
    let text='';for await(const chunk of req)text+=chunk;
    const next=await repo.push('owner',id,req.headers['if-match'],text);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(next));
   } else {
    const doc=repo.pull('owner',id);
    res.writeHead(200,{'content-type':'text/html','etag':doc.revision,'cache-control':'no-store'});
    res.end(pack(doc.source,doc.initialState));
   }
  }catch(e){res.writeHead(e.code==='CONFLICT'?409:400);res.end(String(e.code));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='https://localhost:'+server.address().port;
 const request=(path,options={})=>new Promise((resolve,reject)=>{
  const req=https.request(origin+path,{ca,...options},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end(options.body);
 });
 assert.equal((await request('/?id=none')).status,401);
 await assert.rejects(request('/?id=none',{servername:'wrong.example'}),/hostname|altnames/i);
 await assert.rejects(request('/?id=none',{ca:undefined}),/self.signed|certificate/i);
 for(const [engine,driver] of Object.entries({chromium,firefox,webkit})) {
  const browser=await driver.launch();
  try {
   // Browsers accept the disposable certificate; Node requests above independently validate its chain/hostname.
   const context=await browser.newContext({ignoreHTTPSErrors:true});
   const page=await context.newPage();const file=join(dir,engine+'.html');
   await writeFile(file,fixture);
   const ready=async()=>{await page.waitForFunction(()=>window.composed?.ready||window.composed?.error);assert.equal(await page.evaluate(()=>window.composed.error),undefined);};
   const samplesMs=[];
   for(let i=0;i<5;i++) {await page.goto('file://'+file);await ready();samplesMs.push(await page.evaluate(()=>performance.now()));}
   let throttledSamplesMs;
   if(engine==='chromium'){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});throttledSamplesMs=[];for(let i=0;i<5;i++){await page.goto('file://'+file);await ready();throttledSamplesMs.push(await page.evaluate(()=>performance.now()));}await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();}
   const localRevision=await page.evaluate(()=>window.composed.revision);
   await page.evaluate(()=>window.composed.setState({count:7}));
   const localExport=await page.evaluate(()=>window.composed.exportFile());
   const id='candidate-'+engine;await repo.create('owner',id,localExport,'private');
   await context.addCookies([{name:'session',value:'synthetic-owner',url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);
   await page.goto(origin+'/?id='+id);await ready();
   assert.equal(await page.evaluate(()=>window.composed.revision),localRevision);
   assert.deepEqual(await page.evaluate(()=>window.composed.leaveHistory()),{count:7});
   const pulled=await request('/?id='+id,{headers:{cookie:'session=synthetic-owner'}});
   assert.equal(pulled.status,200);assert.equal(pulled.headers.etag,localRevision);
   const changed=pulled.body.replace('>Original title<','>Edited title<');
   const pushed=await request('/?id='+id,{method:'PUT',headers:{cookie:'session=synthetic-owner','if-match':localRevision},body:changed});
   assert.equal(pushed.status,200);const editedRevision=JSON.parse(pushed.body).revision;
   assert.equal((await request('/?id='+id,{method:'PUT',headers:{cookie:'session=synthetic-owner','if-match':localRevision},body:changed})).status,409);
   assert.equal((await request('/?id='+id)).status,401);
   assert.equal(repo.pull('owner',id,localRevision).source.includes('Original title'),true);
   repo.comment('owner',id,{id:'comment',sourceRevision:localRevision,snapshot:{count:3},targetId:'heading',body:'Keep this context'});
   assert.equal(repo.context('owner',id,'comment').source.revision,localRevision);
   await page.reload();await ready();assert.equal(await page.locator('h1').first().textContent(),'Edited title');
   const oldContext=repo.context('owner',id,'comment');
   await page.evaluate(async c=>window.composed.installContext({id:c.comment.id,sourceRevision:c.comment.sourceRevision,source:c.source.source,targetId:c.comment.targetId,body:c.comment.body,snapshot:c.comment.snapshot}),oldContext);
   const portableContext={id:oldContext.comment.id,sourceRevision:oldContext.comment.sourceRevision,source:oldContext.source.source,targetId:oldContext.comment.targetId,body:oldContext.comment.body,snapshot:oldContext.comment.snapshot};
   assert.equal(await page.evaluate(async c=>{try{await window.composed.installContext({...c,sourceRevision:'wrong'});return false;}catch{return true;}},portableContext),true);
   const raced=await page.evaluate(async c=>(await Promise.allSettled([window.composed.installContext({...c,id:'race',body:'first'}),window.composed.installContext({...c,id:'race',body:'second'})])).map(r=>r.status),portableContext);
   assert.equal(raced.filter(s=>s==='fulfilled').length,1);assert.equal(raced.filter(s=>s==='rejected').length,1);
   const beforeHistory=await page.evaluate(()=>window.composed.exportFile());
   const historical=await page.evaluate(()=>window.composed.enterComment('comment'));
   assert.deepEqual(historical.snapshot,{count:3});assert.equal(historical.revision,localRevision);assert.ok(historical.html.includes('Original title'));assert.ok(!historical.html.includes('Edited title'));
   assert.equal(await page.frameLocator('iframe').locator('h1').textContent(),'Original title');
   assert.equal(await page.locator('h1').first().textContent(),'Edited title');
   assert.equal(await page.evaluate(()=>window.composed.publishDuringHistory()),false);
   assert.equal(await page.evaluate(async c=>{try{await window.composed.installContext({...c,id:'history-write'});return false;}catch{return true;}},portableContext),true);
   assert.equal(await page.evaluate(()=>window.composed.exportFile()),beforeHistory);
   assert.deepEqual(await page.evaluate(()=>window.composed.leaveHistory()),{count:7});
   const downloaded=await page.evaluate(()=>window.composed.exportFile());assert.equal(downloaded.includes('synthetic-owner'),false);await writeFile(file,downloaded);
   // WebKit's driver offline flag also prevents file navigation; deny all network instead.
   let attemptedNetwork=0;await context.route(/^https?:/,route=>{attemptedNetwork++;return route.abort('internetdisconnected');});await page.goto('file://'+file);await ready();
   const offlineRevision=await page.evaluate(()=>window.composed.revision);
   assert.equal(await page.locator('h1').first().textContent(),'Edited title');
   assert.equal(await page.locator('af-markdown h2').textContent(),'Offline notes');
   assert.deepEqual(await page.evaluate(()=>window.composed.leaveHistory()),{count:7});
   assert.equal(await page.evaluate(()=>window.composed.exportFile()),downloaded);
   const offlineHistory=await page.evaluate(()=>window.composed.enterComment('comment'));assert.deepEqual(offlineHistory.snapshot,{count:3});assert.equal(offlineHistory.revision,localRevision);assert.ok(offlineHistory.html.includes('Original title'));
   assert.equal(await page.frameLocator('iframe').locator('h1').textContent(),'Original title');
   assert.deepEqual(await page.evaluate(()=>window.composed.leaveHistory()),{count:7});
   assert.equal(await page.evaluate(()=>window.composed.exportFile()),downloaded);
   assert.equal(attemptedNetwork,0,'Portable boot must not attempt HTTP');
   const receipt={engine,throttledSamplesMs,localRevision,editedRevision,offlineRevision,samplesMs,runtimeBytes:Buffer.byteLength(runtime),gzipBytes:gzipSync(runtime).length,tlsVerified:true,assertions:['local','hosted','edited','downloaded','offline','history','unauthorized','conflict']};
   validateReceipt(receipt);receipts.push(receipt);await context.close();
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({scope:'candidate-only',receipts},null,2));
}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(dir,{recursive:true,force:true});}
