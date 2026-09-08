/** Real delayed trusted controls: query rows, write permission and persistent writes. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:https';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {chromium} from './lib/gate-browser.mjs';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';

const requested=Number(process.argv.find(a=>a.startsWith('--port-base='))?.split('=')[1]??0);
assert(Number.isInteger(requested)&&(requested===0||requested>=1024)&&requested<65534);
const leases=await Promise.all([0,1].map(async offset=>{const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(requested?requested+offset:0,'127.0.0.1',resolve);});return socket;}));
const [port,backendPort]=leases.map(socket=>socket.address().port);
await Promise.all(leases.map(socket=>new Promise(resolve=>socket.close(resolve))));
const scratch=mkdtempSync(join(tmpdir(),'afbin-late-controls-'));
const base=`https://artifactbin.test:${port}`,controls=`https://i.artifactbin.test:${port}`,backend=`http://127.0.0.1:${backendPort}`;
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=artifactbin.test','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
const tls=createServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},(req,res)=>{
 const upstream=request(backend+req.url,{method:req.method,headers:{...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':'https'}},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
const api=(url,init={})=>new Promise((resolve,reject)=>{
 const req=request(url,{method:init.method??'GET',headers:{...init.headers,host:new URL(base).host}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(init.body);
});
let server,browser;
try{
 await new Promise(resolve=>tls.listen(port,'127.0.0.1',resolve));
 server=spawn(process.execPath,[resolve('dist/proxy-server.mjs')],{cwd:resolve('services/app'),stdio:['ignore','ignore','inherit'],env:{...process.env,NODE_ENV:'production',APP__PORT:String(backendPort),APP__PUBLIC_BASE_URL:base,APP__CONTROLS_ORIGIN:'',AUTH__SECRET:randomBytes(32).toString('hex'),DATABASE_URL:'pglite://memory',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:'',EVENTS__SERVICE_URL:'',OBJECT_STORE__LOCAL_DIR:join(scratch,'objects'),ARTIFACTS__ALLOW_PUBLIC:'1',PROXY__RATE_LIMIT_CONFIG_FILE:resolve('services/proxy/dev_rate_limits.yml')}});
 let ready=false;for(let i=0;i<300;i++){if(server.exitCode!==null)throw Error('server exited');if(await api(backend+'/health').then(r=>r.ok).catch(()=>false)){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert(ready);
 const seed=await startDocument(backend,{},api),headers={Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'};
 const published=await api(backend+'/api/artifacts',{method:'POST',headers,body:JSON.stringify({dataset:[{n:41}],access:'readwrite'})});assert(published.ok,await published.clone().text());const dataset=await published.json();
 const markup=`<Helmet><Query name="rows">{\`select * from ref_${dataset.id}\`}</Query><Mutation name="increment">{\`update ref_${dataset.id} set n=n+1\`}</Mutation></Helmet><h1>Delayed controls query</h1><Number aria-label="Persistent number" data="$rows" col="n" agg="sum"/><Button run="$increment" aria-label="Increment persistent number">Increment persistent number</Button>`;
 const saved=await api(`${backend}/api/artifacts/${seed.id}`,{method:'PUT',headers,body:JSON.stringify({markup,expectedVersion:1})});assert(saved.ok,await saved.clone().text());
 browser=await chromium.launch({args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']});
 const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
 await becomeOwner(page,base,seed.token);
 let delayed=0;const durations=[],queries=[],writes=[];
 page.on('request',req=>{
   if(req.url().includes('/query') || (req.method()==='POST'&&req.url().includes('/mutate'))){
     assert.equal(req.frame(),page.mainFrame(),'query/mutation transport belongs to first-party runtime, never author frame');
     if(req.url().includes('/query'))queries.push(req.url());else writes.push(req.url());
   }
 });
 await page.route(base+'/api/page/artifact/**',async route=>{
   delayed++;const started=Date.now();
   assert.equal(await page.locator('[data-artifact-story-host]').count(),0,'no runtime mounts before delayed page data');
   await new Promise(resolve=>setTimeout(resolve,5000));durations.push(Date.now()-started);await route.continue();
 });
 for(let load=0;load<2;load++){
  await page.goto(base+'/');await page.getByLabel('Shelf',{exact:true}).waitFor();
  const started=Date.now();
  await page.locator(`[aria-label="Shelf"] a[href="/a/${seed.id}"]`).first().click();
  try{await page.getByText(String(41+load),{exact:true}).waitFor({timeout:13000});await page.getByRole('button',{name:'Increment persistent number',exact:true}).click({timeout:3000});await page.getByText(String(42+load),{exact:true}).waitFor({timeout:5000});}
  catch(error){console.error(JSON.stringify({load,elapsedMs:Date.now()-started,delayed,queries:queries.length,writes:writes.length,body:(await page.locator('body').innerText()).slice(0,1000)}));throw error;}
 }
 assert.equal(delayed,2);assert(durations.every(ms=>ms>=5000),'both actual page-data requests were delayed at least 5s');assert.equal(writes.length,2,'one persistent mutation per user click');
 await page.unroute(base+'/api/page/artifact/**');await page.reload();await page.getByText('43',{exact:true}).waitFor();
 assert(queries.length>0,'the initial read reached the authenticated query endpoint');
 assert([...queries,...writes].every(url=>new URL(url).origin===base),'every browser query and persistent write stays on the first-party main origin');
 const stored=await api(`${backend}/api/artifacts/${dataset.id}`,{headers});assert(stored.ok);const content=await stored.json();
 assert.equal(content.rows[0].n,43,'the dataset persisted both writes');
 console.log(JSON.stringify({ok:true,delayedLoads:delayed,delayMs:5000,queryRequests:queries.length,persistentWrites:writes.length,trustedOriginOnly:true,finalNumber:43}));
}finally{
 await browser?.close();if(server&&server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));const force=setTimeout(()=>server.kill('SIGKILL'),2000);server.kill('SIGTERM');await exited;clearTimeout(force);}
 tls.closeAllConnections();await new Promise(resolve=>tls.close(resolve));rmSync(scratch,{recursive:true,force:true});
}
