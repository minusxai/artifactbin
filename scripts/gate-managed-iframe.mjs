/** Actual publish/read/asset-host acceptance; deterministic CDN, no third-party dependency. */
import {fixtureFetch as fetch, observeFixtureWrite} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createServer as httpsServer} from 'node:https';
import {createServer} from 'node:http';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import sharp from 'sharp';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';

const engineName=process.argv.find(arg=>arg.startsWith('--browser='))?.split('=')[1]??'chromium';
const engine={chromium,firefox,webkit}[engineName];assert(engine);
const requestedPort=Number(process.argv.find(arg=>arg.startsWith('--port-base='))?.split('=')[1]??0);
assert(Number.isInteger(requestedPort)&&requestedPort>=0&&requestedPort<=65533);
// Like the trusted-controls gate this needs its own configured-origin server.
// Generic gate-runner base is intentionally unused. Default ports are ephemeral;
// delegated local work passes its reserved --port-base explicitly.
const leases=await Promise.all([0,1,2].map(async offset=>{const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(requestedPort?requestedPort+offset:0,'127.0.0.1',resolve);});return socket;}));
const [port,backendPort,cdnPort]=leases.map(socket=>socket.address().port);
await Promise.all(leases.map(socket=>new Promise(resolve=>socket.close(resolve))));
const scratch=mkdtempSync(join(tmpdir(),'afbin-managed-gate-'));
const backend=`http://127.0.0.1:${backendPort}`,cdn=`http://127.0.0.1:${cdnPort}`;
// Default CI Chromium has no third-party DNS dependency. The explicit optional
// cross-engine probes use the same nip.io mechanism as trusted-controls.
const hostname=engineName==='chromium'?'artifactbin.test':'127.0.0.1.nip.io',base=`https://${hostname}:${port}`,controls=`https://i.${hostname}:${port}`,assets=`https://assets.${hostname}:${port}`;
const hits=new Map(),wire=[];
const fixture=createServer((req,res)=>{
  hits.set(req.url,(hits.get(req.url)??0)+1);
  const files={
    '/one.js':['text/javascript','window.bundleOrder="A";'],
    '/two.js':['text/javascript','window.bundleOrder+="B";export const loaded=true;'],
    '/dynamic.js':['text/javascript','window.dynamicLoaded=true;'],
    '/data.json':['application/json','{"answer":42}'],
    '/image.png':['image/png',readFileSync(resolve('services/app/public/logo-256.png'))],
  };
  const item=files[req.url];if(!item){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':item[0]});res.end(item[1]);
});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=artifactbin.test','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
const tls=httpsServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},(req,res)=>{
  wire.push({host:req.headers.host,url:req.url,method:req.method});
  const upstream=httpRequest(backend+req.url,{method:req.method,headers:{...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':'https'}},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
const rawMainFetch=(url,init={})=>new Promise((resolve,reject)=>{
  const req=httpRequest(url,{method:init.method??'GET',headers:{...init.headers,host:new URL(base).host}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
  });req.on('error',reject);req.end(init.body);
});
const mainFetch=(url,init)=>observeFixtureWrite(rawMainFetch,url,init);
let server,browser;
try {
  await new Promise(resolve=>fixture.listen(cdnPort,'127.0.0.1',resolve));
  await new Promise(resolve=>tls.listen(port,'127.0.0.1',resolve));
  server=spawn(process.execPath,[resolve('dist/proxy-server.mjs')],{cwd:resolve('services/app'),stdio:['ignore','ignore','inherit'],env:{...process.env,
    NODE_ENV:'production',APP__PORT:String(backendPort),APP__PUBLIC_BASE_URL:base,APP__ASSETS_ORIGIN:assets,
    EMAIL__RESEND_API_KEY:'mxmx_test_managed',AUTH__SECRET:randomBytes(32).toString('hex'),DATABASE_URL:'pglite://memory',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:'',EVENTS__SERVICE_URL:'',
    OBJECT_STORE__LOCAL_DIR:join(scratch,'objects'),ARTIFACTS__ALLOW_PUBLIC:'1',WEB_INGEST__ALLOW_PRIVATE:'1',PROXY__RATE_LIMIT_CONFIG_FILE:resolve('services/proxy/dev_rate_limits.yml'),
  }});
  let ready=false;for(let i=0;i<300;i++){if(server.exitCode!==null)throw Error('server exited');if(await mainFetch(backend+'/health').then(r=>r.ok).catch(()=>false)){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
  const seed=await startDocument(backend,{},mainFetch);
  const authHeaders={Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'};
  const datasetResponse=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:authHeaders,body:JSON.stringify({title:'Managed mutation rows',dataset:[{id:1,item:'before'}],access:'readwrite',visibility:'unlisted'})});assert(datasetResponse.ok,await datasetResponse.clone().text());const datasetId=(await datasetResponse.json()).id;
  const uploaded=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({file:{filename:'ref.png',contentType:'image/png',base64:readFileSync(resolve('services/app/public/logo-256.png')).toString('base64')}})});assert(uploaded.ok,await uploaded.clone().text());const refId=(await uploaded.json()).id;
  const author=`for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection']){const d=Object.getOwnPropertyDescriptor(globalThis,name);if(globalThis[name]!==undefined||!d||d.configurable||d.writable)throw Error('WebRTC not locked down');}
  document.querySelector('#increment').style.cssText='display:block;width:120px;height:40px';document.querySelector('#increment').onclick=()=>mx.params.set('count',Number(mx.params.get('count')??0)+1);mx.params.subscribe(['count'],values=>document.querySelector('#increment').textContent='Count '+values.count);
  document.querySelector('#write').onclick=()=>mx.mutate('rename',{item:'changed'}).then(()=>document.querySelector('#mutation').textContent='written',()=>document.querySelector('#mutation').textContent='denied');
  const imageReady=image=>new Promise((resolve,reject)=>{if(image.complete&&image.naturalWidth)resolve();else{image.onload=resolve;image.onerror=reject;}});
  const image=new Image();const dynamicImage=imageReady(image);image.src='${cdn}/image.png';document.body.append(image);
  const refImage=new Image();const publicRef=imageReady(refImage);refImage.src='ref:${refId}';document.body.append(refImage);
  const script=document.createElement('script');const dynamicScript=new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;});script.setAttribute('src','${cdn}/dynamic.js');document.body.append(script);
  Promise.all([fetch('${cdn}/data.json').then(r=>r.json()),imageReady(document.querySelector('img')),dynamicImage,dynamicScript,publicRef]).then(([data])=>document.getElementById('result').textContent=window.bundleOrder+':'+data.answer+':'+window.dynamicLoaded);`;
  const markup='<Helmet><Value name="count" type="number" default={0}/><Value name="item" type="string" default="changed"/><Mutation name="rename" source="ref:'+datasetId+'" expectedAffected={1}>{`update public.rows set item=$item where id=1`}</Mutation></Helmet><p>Managed parent</p><Iframe title="Managed demo" height={200}><button id="increment">Increment</button><button id="write">Write dataset</button><p id="mutation">waiting</p><p id="result">waiting</p><canvas width="30" height="30"/><img src="'+cdn+'/image.png"/><script src="'+cdn+'/one.js"/><script type="module" src="'+cdn+'/two.js"/><script>{`'+author+'`}</script></Iframe><Iframe title="Second" height={100}><p>Second isolated region</p></Iframe>';
  const hostile='<Iframe title="Navigation refusal" height={100}><script>{`location.href="'+controls+'/managed-denied"`}</script></Iframe>';
  const published=await mainFetch(`${backend}/api/artifacts/${seed.id}`,{method:'PUT',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:markup+hostile,expectedVersion:1})});assert(published.ok,await published.text());
  browser=await engine.launch({headless:true,...(engineName==='chromium'?{args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1, MAP assets.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']}:{})});
  const staticContext=await browser.newContext({ignoreHTTPSErrors:true,javaScriptEnabled:false}),staticPage=await staticContext.newPage();
  await staticPage.goto(base+'/a/'+seed.id);
  assert(Math.abs((await staticPage.getByLabel('Managed demo',{exact:true}).boundingBox()).height-200)<0.1,'SSR reserves frame height');await staticContext.close();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:900,height:700}}),page=await context.newPage();
  await becomeOwner(page,base,seed.token);
  page.on('pageerror',error=>console.error('PAGE',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('CONSOLE',message.text());});
  for(let attempt=0;attempt<2;attempt++) {
    await page.goto(base+'/a/'+seed.id);
    await page.locator('[data-mx-inline-story]').waitFor();
    const artifact=page;
    const outer=artifact.locator('iframe[title="Managed demo"]');await outer.waitFor();
    const wrapper=await outer.contentFrame();const inner=wrapper.locator('iframe');await inner.waitFor();const realm=await inner.contentFrame();
    await realm.locator('#result').filter({hasText:'AB:42:true'}).waitFor({timeout:20000});
    assert.equal(await artifact.locator('canvas').count(),0,'author DOM never enters parent');
    const box=await outer.boundingBox();assert(box);
    assert(Math.abs(box.height-200)<0.1,'hydration preserves frame height');
    await realm.locator('#increment').click();await realm.locator('#increment').filter({hasText:'Count 1'}).waitFor();
    if(attempt===0){await realm.locator('#write').click();await realm.locator('#mutation').filter({hasText:'written'}).waitFor();const stored=await mainFetch(backend+'/api/artifacts/'+datasetId,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());assert.equal(stored.rows[0].item,'changed','managed mutation persisted on server');const locked=await mainFetch(backend+'/api/artifacts/'+datasetId,{method:'PUT',headers:authHeaders,body:JSON.stringify({dataset:stored.rows,access:'read'})});assert(locked.ok,await locked.text());}
    else {await realm.locator('#write').click();await realm.locator('#mutation').filter({hasText:'denied'}).waitFor();const stored=await mainFetch(backend+'/api/artifacts/'+datasetId,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());assert.equal(stored.rows[0].item,'changed','denied managed mutation did not alter rows');}
  }
  assert.equal(wire.filter(row=>row.url==='/managed-denied').length,0,'nested author cannot navigate to controls origin');
  // Positive control: the parent policy admits a same-origin frame destination;
  // the nested opaque author realm above still cannot navigate there.
  await page.evaluate(url=>{const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=url;document.body.append(frame);},base+'/managed-positive');
  for(let i=0;i<100&&!wire.some(row=>row.url==='/managed-positive');i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert(wire.some(row=>row.url==='/managed-positive'),'single-frame navigation positive control reached server');
  await page.goto(base+'/a/'+seed.id+'/raw');
  {const outer=page.locator('iframe[title="Managed demo"]');await outer.waitFor();const wrapper=await outer.contentFrame();const inner=wrapper.locator('iframe');await inner.waitFor();const realm=await inner.contentFrame();await realm.locator('#result').filter({hasText:'AB:42:true'}).waitFor({timeout:20000});}
  assert.equal(await page.locator('canvas').count(),0,'raw compatibility remains isolated');
  for(const path of ['/one.js','/two.js','/dynamic.js','/data.json','/image.png'])assert.equal(hits.get(path),1,path+' imported once');
  assert(wire.some(row=>row.host===new URL(assets).host&&row.url.startsWith('/assets/')),'cached assets served on dedicated origin');
  assert(wire.filter(row=>row.host===new URL(assets).host&&row.url==='/assets/ref/'+refId).length>=3,'public refs re-read without immutable caching');
  // The export Chromium has NO host-resolver override or self-signed TLS bypass.
  // Its asset URL can only work through the renderer's internal byte transport.
  const exportMarkup='<main><Iframe title="Internal export" height={100}><style>{`body{margin:0}`}</style><canvas width="100" height="100"/><script src="'+cdn+'/one.js"/><script type="module">{`await new Promise(resolve=>setTimeout(resolve,1800));const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle=window.bundleOrder==="A"?"#33cc33":"#cc3333";ctx.fillRect(0,0,100,100);`}</script></Iframe></main>';
  const exportDoc=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:authHeaders,body:JSON.stringify({title:'Internal asset export',markup:exportMarkup,visibility:'unlisted'})});assert(exportDoc.ok,await exportDoc.clone().text());
  const exportId=(await exportDoc.json()).id, beforeExportWire=wire.length;
  const exported=await mainFetch(backend+'/a/'+exportId+'/export?format=png');assert(exported.ok,await exported.clone().text());
  const {data:pixels,info}=await sharp(Buffer.from(await exported.arrayBuffer())).raw().toBuffer({resolveWithObject:true});
  let green=0;for(let offset=0;offset<pixels.length;offset+=info.channels)if(pixels[offset]===51&&pixels[offset+1]===204&&pixels[offset+2]===51)green++;
  assert(green>=9000,'cold managed export includes the cached library and awaited canvas');
  assert.equal(wire.slice(beforeExportWire).filter(row=>row.host===new URL(assets).host).length,0,'export cached assets bypass public TLS entirely');
  console.log(JSON.stringify({engine:engineName,version:browser.version(),loads:3,signals:true,persistentMutation:true,permissionDenial:true,bundledClassicAndModule:true,dynamicImageAndScript:true,rawCompatibility:true,immutableWebRtcDenial:true,ssrHeightStable:true,nestedNavigationBlocked:true,singleNavigationControl:true,internalColdExport:true,cdnHits:Object.fromEntries(hits),assetRequests:wire.filter(row=>row.host===new URL(assets).host).length}));
} finally {
  await browser?.close();
  if(server&&server.exitCode===null){
    const exited=once(server,'exit');server.kill('SIGTERM');
    // In-process Chromium installs signal handlers; a gate's disposable app
    // must not keep CI alive indefinitely after all assertions have completed.
    const force=setTimeout(()=>server.kill('SIGKILL'),5000);force.unref();
    try{await exited;}finally{clearTimeout(force);}
  }
  tls.closeAllConnections();fixture.closeAllConnections();
  await new Promise(resolve=>tls.close(resolve));await new Promise(resolve=>fixture.close(resolve));rmSync(scratch,{recursive:true,force:true});
}
